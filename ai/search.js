/**
 * 联网搜索模块 - 通过 RSS 新闻源和 WebFetch 获取实时信息
 * 替代搜索引擎，直接从权威信息源获取最新内容
 */
const https = require('https');
const http = require('http');

/**
 * 从 URL 获取内容
 */
function fetchUrl(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
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

/**
 * 解析简单 RSS XML
 */
function parseRSS(xml) {
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
        title: title.replace(/<[^>]+>/g, '').trim(),
        url: link.trim(),
        snippet: desc.replace(/<[^>]+>/g, '').trim().slice(0, 200),
        date: pubDate.trim(),
      });
    }
  }
  return items;
}

/**
 * 从新闻 RSS 源获取最新信息
 */
async function fetchRSS(feedUrl) {
  try {
    const xml = await fetchUrl(feedUrl);
    return parseRSS(xml);
  } catch (err) {
    console.error(`RSS 获取失败 [${feedUrl}]:`, err.message);
    return [];
  }
}

// 预设的高质量 RSS 源
const RSS_FEEDS = {
  tech_cn: [
    'https://36kr.com/feed',                    // 36氪
    'https://www.ifanr.com/feed',               // 爱范儿
  ],
  tech_en: [
    'https://hnrss.org/newest?points=100',      // Hacker News 热门
    'https://www.theverge.com/rss/index.xml',   // The Verge
    'https://techcrunch.com/feed/',             // TechCrunch
  ],
  ai: [
    'https://hnrss.org/newest?q=AI+LLM&points=50',
  ],
};

/**
 * 根据话题搜索最新新闻
 * @param {string} query - 搜索关键词
 * @param {string} category - 源类别: tech_cn, tech_en, ai
 * @returns {Array} 搜索结果
 */
async function searchWeb(query, maxResults = 5, category = 'tech_cn') {
  const feeds = RSS_FEEDS[category] || RSS_FEEDS.tech_cn;
  const allItems = [];

  for (const feedUrl of feeds) {
    const items = await fetchRSS(feedUrl);
    allItems.push(...items);
  }

  // 按关键词过滤
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

  const scored = allItems.map(item => {
    const text = (item.title + ' ' + item.snippet).toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (text.includes(word)) score += 1;
    }
    return { ...item, score };
  }).filter(item => item.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

/**
 * 获取多个话题的最新信息
 */
async function searchAndSummarize(query, maxResults = 3) {
  // 同时搜索中文和英文源
  const [cnResults, enResults, aiResults] = await Promise.all([
    searchWeb(query, maxResults, 'tech_cn'),
    searchWeb(query, maxResults, 'tech_en'),
    searchWeb(query, maxResults, 'ai'),
  ]);

  const allResults = [...cnResults, ...enResults, ...aiResults];
  if (allResults.length === 0) {
    return `搜索"${query}"未找到相关最新新闻。请基于你的知识撰写，但务必确保内容是截至当前日期的最新信息。`;
  }

  let summary = `以下是"${query}"的最新相关资讯（来自权威科技媒体）：\n\n`;
  for (const r of allResults.slice(0, maxResults)) {
    summary += `📄 ${r.title}\n`;
    if (r.url) summary += `   来源: ${r.url}\n`;
    if (r.snippet) summary += `   摘要: ${r.snippet}\n`;
    if (r.date) summary += `   日期: ${r.date}\n`;
    summary += '\n';
  }
  return summary;
}

/**
 * 获取综合最新新闻（用于规划 Agent 了解当前热点）
 */
async function getLatestNews(maxPerFeed = 5) {
  const allFeeds = [...RSS_FEEDS.tech_cn, ...RSS_FEEDS.tech_en];
  const allItems = [];

  for (const feedUrl of allFeeds) {
    const items = await fetchRSS(feedUrl);
    allItems.push(...items.slice(0, maxPerFeed));
  }

  // 按日期排序
  allItems.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return allItems.slice(0, 20);
}

module.exports = { searchWeb, searchAndSummarize, fetchRSS, getLatestNews };
