/**
 * 联网搜索模块 v3 - 多引擎搜索 + AI 自管理 RSS
 *
 * 架构：
 *   搜索引擎为主（DuckDuckGo / Bing / SearXNG，无需 API Key）
 *   Tavily 为加强（有 key 就用，没有不影响）
 *   RSS 为辅助（AI 自动发现并保存符合网站主题的源）
 */
const https = require('https');
const http = require('http');

// ==================== 基础工具 ====================

function cleanText(text = '') {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveRedirectUrl(currentUrl, location) {
  return new URL(location, currentUrl).toString();
}

function fetchUrl(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(resolveRedirectUrl(url, res.headers.location), timeout).then(resolve).catch(reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function postJSON(url, data, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname, port: parsed.port || 443,
      path: parsed.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => { try { resolve(JSON.parse(responseBody)); } catch { reject(new Error('JSON 解析失败')); } });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body);
    req.end();
  });
}

function getConfig(key) {
  try {
    const { getSetting } = require('../db/database');
    return getSetting(key) || '';
  } catch { return ''; }
}

function getSiteTheme() {
  try {
    const site = require('../config').getSiteConfig();
    return { title: site.title || '', theme: site.theme || '', direction: site.direction || '' };
  } catch { return { title: '', theme: '', direction: '' }; }
}

async function collectSearchResults(engines, maxResults = 5) {
  const seen = new Set();
  const collected = [];

  for (const engine of engines) {
    let results = [];
    try {
      results = await engine();
    } catch (err) {
      console.error('搜索引擎兜底失败:', err.message);
      continue;
    }
    for (const result of results || []) {
      if (!result?.url || seen.has(result.url)) continue;
      seen.add(result.url);
      collected.push(result);
      if (collected.length >= maxResults) return collected;
    }
  }

  return collected;
}

// ==================== 搜索引擎（无需 API Key） ====================

/**
 * DuckDuckGo HTML 搜索（零配置，永远可用）
 */
async function searchDuckDuckGo(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const html = await fetchUrl(`https://html.duckduckgo.com/html/?q=${encoded}`, 12000);
    const results = [];
    // 解析 DDG HTML 结果
    const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const links = [];
    while ((match = linkRegex.exec(html)) !== null && links.length < maxResults) {
      let url = match[1];
      // DDG 的链接可能是跳转链接，提取真实 URL
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      if (title && url.startsWith('http')) links.push({ title, url });
    }
    const snippets = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
    }
    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || '',
        source: 'duckduckgo',
      });
    }
    return results;
  } catch (err) {
    console.error('DuckDuckGo 搜索失败:', err.message);
    return [];
  }
}

/**
 * Bing HTML 搜索（零配置，永远可用）
 */
async function searchBing(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const html = await fetchUrl(`https://www.bing.com/search?q=${encoded}&count=${maxResults}`, 12000);
    const results = [];
    const itemRegex = /<li class="b_algo"[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = itemRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();
      if (title && url.startsWith('http')) {
        results.push({ title, url, snippet, source: 'bing' });
      }
    }
    return results;
  } catch (err) {
    console.error('Bing 搜索失败:', err.message);
    return [];
  }
}

/**
 * SearXNG 公开实例搜索（零配置，聚合多引擎）
 */
async function searchSearXNG(query, maxResults = 5) {
  const instances = [
    'https://search.sapti.me',
    'https://searx.tiekoetter.com',
    'https://search.bus-hit.me',
  ];
  for (const instance of instances) {
    try {
      const encoded = encodeURIComponent(query);
      const html = await fetchUrl(`${instance}/search?q=${encoded}&format=html`, 10000);
      const results = [];
      const itemRegex = /<article[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*class="content"[^>]*>([\s\S]*?)<\/p>/gi;
      let match;
      while ((match = itemRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        const snippet = match[3].replace(/<[^>]+>/g, '').trim();
        if (title && url.startsWith('http')) {
          results.push({ title, url, snippet, source: 'searxng' });
        }
      }
      if (results.length > 0) return results;
    } catch { continue; }
  }
  return [];
}

// ==================== Tavily（付费加强） ====================

async function searchTavilySingle(query, maxResults = 5) {
  const apiKey = getConfig('tavily_api_key');
  if (!apiKey) return [];
  try {
    const result = await postJSON('https://api.tavily.com/search', {
      api_key: apiKey, query, max_results: maxResults,
      search_depth: 'basic', include_answer: false,
    });
    if (!result.results || !Array.isArray(result.results)) return [];
    return result.results.map(r => ({
      title: r.title || '', url: r.url || '',
      snippet: (r.content || '').slice(0, 300), source: 'tavily',
    }));
  } catch (err) {
    console.error('Tavily 搜索失败:', err.message);
    return [];
  }
}

// ==================== RSS 辅助（AI 自管理） ====================

let tavilyKeyCursor = 0;

function parseTavilyKeys(value = '') {
  const seen = new Set();
  return String(value || '')
    .split(/[\n,]+/)
    .map(key => key.trim())
    .filter(Boolean)
    .filter((key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resetTavilyKeyCursor() {
  tavilyKeyCursor = 0;
}

function maskTavilyKey(key = '') {
  const value = String(key || '').trim();
  if (value.length <= 8) return value ? `${value.slice(0, 2)}***` : '';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function searchTavily(query, maxResults = 5, options = {}) {
  const keys = parseTavilyKeys(options.apiKeys ?? getConfig('tavily_api_key'));
  if (keys.length === 0) return [];
  const post = options.postJSON || postJSON;
  const startIndex = tavilyKeyCursor % keys.length;
  tavilyKeyCursor = (tavilyKeyCursor + 1) % keys.length;

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[(startIndex + i) % keys.length];
    try {
      const result = await post('https://api.tavily.com/search', {
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
      });
      if (!result.results || !Array.isArray(result.results)) continue;
      return result.results.map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: (r.content || '').slice(0, 300),
        source: 'tavily',
      }));
    } catch (err) {
      console.error(`Tavily 搜索失败(key ${i + 1}/${keys.length}):`, err.message);
    }
  }

  return [];
}

async function testTavilyKeys(keysInput, options = {}) {
  const keys = parseTavilyKeys(keysInput);
  const post = options.postJSON || postJSON;
  const query = options.query || 'AI news';
  const timeoutMs = options.timeoutMs || 15000;
  const results = [];
  for (const key of keys) {
    try {
      const response = await post('https://api.tavily.com/search', {
        api_key: key,
        query,
        max_results: 1,
        search_depth: 'basic',
        include_answer: false,
      }, timeoutMs);
      const ok = Array.isArray(response.results);
      results.push({ key, ok, resultCount: ok ? response.results.length : 0, error: ok ? '' : '返回格式异常' });
    } catch (err) {
      results.push({ key, ok: false, resultCount: 0, error: err.message });
    }
  }
  return results;
}

function parseSearchRSS(xml, source = 'rss') {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const title = (content.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
    const link = (content.match(/<link>(.*?)<\/link>/i) || [])[1] || '';
    const desc = (content.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/is) || [])[1] || '';
    const pubDate = (content.match(/<pubDate>(.*?)<\/pubDate>/i) || [])[1] || '';
    if (title) {
      items.push({
        title: cleanText(title),
        url: cleanText(link),
        snippet: cleanText(desc).slice(0, 200),
        date: pubDate.trim(),
        source,
      });
    }
  }
  return items;
}

const parseRSS = parseSearchRSS;

async function searchBingNewsRSS(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const xml = await fetchUrl(`https://www.bing.com/news/search?q=${encoded}&format=rss`, 12000);
    return parseSearchRSS(xml, 'bing-news').slice(0, maxResults);
  } catch (err) {
    console.error('Bing News RSS 搜索失败:', err.message);
    return [];
  }
}

async function searchGoogleNewsRSS(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const xml = await fetchUrl(`https://news.google.com/rss/search?q=${encoded}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`, 12000);
    return parseSearchRSS(xml, 'google-news').slice(0, maxResults);
  } catch (err) {
    console.error('Google News RSS 搜索失败:', err.message);
    return [];
  }
}

/**
 * 获取 AI 自管理的 RSS 源列表（从数据库读取）
 */
function getManagedFeeds() {
  try {
    const { getSetting } = require('../db/database');
    const feedsJson = getSetting('rss_feeds');
    if (feedsJson) return JSON.parse(feedsJson);
  } catch {}
  return [];
}

/**
 * 保存 AI 自管理的 RSS 源列表
 */
function saveManagedFeeds(feeds) {
  try {
    const { setSetting } = require('../db/database');
    setSetting('rss_feeds', JSON.stringify(feeds));
  } catch {}
}

/**
 * AI 发现并添加新的 RSS 源
 * @param {string} url - RSS URL
 * @param {string} reason - 添加原因（如："该源覆盖美食领域"）
 */
async function discoverFeed(url, reason) {
  const feeds = getManagedFeeds();
  if (feeds.find(f => f.url === url)) return; // 已存在
  // 验证是否可用
  try {
    const xml = await fetchUrl(url, 8000);
    const items = parseRSS(xml);
    if (items.length === 0) return;
    feeds.push({ url, reason, added_at: new Date().toISOString(), items_found: items.length });
    saveManagedFeeds(feeds);
    console.log(`  📡 发现新 RSS 源: ${url} (${reason})`);
  } catch {}
}

/**
 * 从 AI 管理的 RSS 源搜索
 */
async function searchRSS(query, maxResults = 5) {
  const feeds = getManagedFeeds();
  if (feeds.length === 0) return [];

  const allItems = [];
  for (const feed of feeds) {
    try {
      const items = await fetchRSS(feed.url);
      allItems.push(...items);
    } catch {}
  }

  if (allItems.length === 0) return [];

  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  const scored = allItems.map(item => {
    const text = (item.title + ' ' + item.snippet).toLowerCase();
    let score = 0;
    for (const word of queryWords) { if (text.includes(word)) score += 1; }
    return { ...item, score };
  }).filter(item => item.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

async function fetchRSS(feedUrl) {
  try {
    const xml = await fetchUrl(feedUrl);
    return parseRSS(xml);
  } catch { return []; }
}

// ==================== 核心搜索接口 ====================

/**
 * 搜索最新信息（核心函数）
 *
 * 执行顺序：
 *   1. Tavily（如果有 key，最精准）
 *   2. 多搜索引擎并发（DuckDuckGo + Bing，永远可用）
 *   3. AI 管理的 RSS 源（AI 自动发现的，跟网站主题相关）
 *
 * 所有层都独立运行，任何一层失败不影响其他层
 */
async function searchWeb(query, maxResults = 5) {
  const site = getSiteTheme();
  // 给搜索词加上网站主题上下文
  const themedQuery = site.theme ? `${query} ${site.theme}` : query;

  const results = await collectSearchResults([
    () => searchTavily(themedQuery, maxResults),
    async () => {
      const [ddgResults, bingResults] = await Promise.all([
        searchDuckDuckGo(themedQuery, maxResults),
        searchBing(themedQuery, maxResults),
      ]);
      return [...ddgResults, ...bingResults];
    },
    () => searchSearXNG(themedQuery, maxResults),
    async () => {
      const [bingNews, googleNews] = await Promise.all([
        searchBingNewsRSS(themedQuery, maxResults),
        searchGoogleNewsRSS(themedQuery, maxResults),
      ]);
      return [...bingNews, ...googleNews];
    },
    () => searchRSS(query, maxResults),
  ], maxResults);

  if (results.length > 0) {
    console.log(`  🔍 搜索结果: ${results.length} 条 (${[...new Set(results.map(r => r.source || 'unknown'))].join(', ')})`);
    return results;
  }

  console.log(`  ⚠️ 搜索无结果: "${query}"`);
  return [];
}

/**
 * 获取最新热点新闻（用于规划 Agent）
 */
async function getLatestNews(maxResults = 10) {
  const site = getSiteTheme();
  const hotQuery = site.theme ? `${site.theme} 最新` : '今日热点新闻';
  const tavilyQueries = site.theme
    ? [`${site.theme} 最新动态`, `${site.theme} 趋势`, site.title]
    : ['最新热门资讯', '今日热点'];

  const results = await collectSearchResults([
    async () => {
      const batches = [];
      for (const q of tavilyQueries) batches.push(...await searchTavily(q, 5));
      return batches;
    },
    async () => {
      const [ddgResults, bingResults] = await Promise.all([
        searchDuckDuckGo(hotQuery, 5),
        searchBing(hotQuery, 5),
      ]);
      return [...ddgResults, ...bingResults];
    },
    () => searchSearXNG(hotQuery, maxResults),
    async () => {
      const [bingNews, googleNews] = await Promise.all([
        searchBingNewsRSS(hotQuery, maxResults),
        searchGoogleNewsRSS(hotQuery, maxResults),
      ]);
      return [...bingNews, ...googleNews];
    },
    () => searchRSS(site.theme || 'news', maxResults),
  ], maxResults);

  if (results.length > 0) {
    console.log(`  🔍 最新资讯: ${results.length} 条 (${[...new Set(results.map(r => r.source || 'unknown'))].join(', ')})`);
  }
  return results;
}

module.exports = {
  searchWeb,
  getLatestNews,
  fetchRSS,
  discoverFeed,
  getManagedFeeds,
  saveManagedFeeds,
  collectSearchResults,
  searchTavily,
  testTavilyKeys,
  parseTavilyKeys,
  resetTavilyKeyCursor,
  maskTavilyKey,
  parseSearchRSS,
  resolveRedirectUrl,
};
