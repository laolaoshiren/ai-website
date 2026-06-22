/**
 * Agent 工具系统 - 让 AI Agent 能真正执行操作
 * 类似 MCP 的工具调用机制
 */
const https = require('https');
const http = require('http');

// ============ 工具注册表 ============
const tools = {};

function registerTool(name, description, parameters, handler) {
  tools[name] = { name, description, parameters, handler };
}

function getToolDefinitions() {
  return Object.values(tools).map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

async function executeTool(name, args) {
  if (!tools[name]) throw new Error(`未知工具: ${name}`);
  return await tools[name].handler(args);
}

// ============ 内置工具 ============

// 1. 网页搜索（通过多个搜索引擎）
registerTool('web_search', '搜索互联网获取最新信息', {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索关键词' },
    max_results: { type: 'number', description: '最大结果数', default: 5 }
  },
  required: ['query']
}, async ({ query, max_results = 5 }) => {
  const results = [];

  // 尝试 DuckDuckGo Instant Answer API
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const ddgRes = await fetchJson(ddgUrl);
    if (ddgRes.Abstract) {
      results.push({ title: ddgRes.Heading || query, snippet: ddgRes.Abstract, url: ddgRes.AbstractURL });
    }
    if (ddgRes.RelatedTopics) {
      for (const topic of ddgRes.RelatedTopics.slice(0, max_results)) {
        if (topic.Text) {
          results.push({ title: topic.Text.slice(0, 80), snippet: topic.Text, url: topic.FirstURL });
        }
      }
    }
  } catch {}

  // 尝试 Wikipedia API（中英文）
  try {
    const lang = /[一-鿿]/.test(query) ? 'zh' : 'en';
    const wikiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    const wikiRes = await fetchJson(wikiUrl);
    if (wikiRes.extract) {
      results.unshift({ title: wikiRes.title || query, snippet: wikiRes.extract.slice(0, 300), url: wikiRes.content_urls?.desktop?.page || '' });
    }
  } catch {}

  return { results: results.slice(0, max_results), query, source: 'web_search' };
});

// 2. 读取网页内容
registerTool('fetch_webpage', '获取指定URL的网页内容', {
  type: 'object',
  properties: {
    url: { type: 'string', description: '要读取的网页URL' },
    max_length: { type: 'number', description: '最大返回字符数', default: 3000 }
  },
  required: ['url']
}, async ({ url, max_length = 3000 }) => {
  try {
    const html = await fetchUrl(url);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max_length);
    return { url, content: text, length: text.length };
  } catch (e) {
    return { url, error: e.message };
  }
});

// 3. 获取最新新闻
registerTool('get_latest_news', '获取最新科技新闻', {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['tech_cn', 'tech_en', 'ai', 'all'], description: '新闻类别', default: 'all' },
    max_per_feed: { type: 'number', description: '每个源最大条数', default: 5 }
  }
}, async ({ category = 'all', max_per_feed = 5 }) => {
  const { getLatestNews, searchWeb } = require('./search');
  try {
    if (category === 'all') {
      const news = await getLatestNews(max_per_feed);
      return { news, count: news.length, source: 'rss_feeds' };
    } else {
      const results = await searchWeb('', max_per_feed, category);
      return { news: results, count: results.length, source: 'rss_' + category };
    }
  } catch (e) {
    return { error: e.message, news: [] };
  }
});

// 4. 搜索特定话题新闻
registerTool('search_topic_news', '搜索特定话题的最新新闻', {
  type: 'object',
  properties: {
    topic: { type: 'string', description: '搜索话题' },
    max_results: { type: 'number', description: '最大结果数', default: 5 }
  },
  required: ['topic']
}, async ({ topic, max_results = 5 }) => {
  const { searchWeb } = require('./search');
  try {
    const cnResults = await searchWeb(topic, max_results, 'tech_cn');
    const enResults = await searchWeb(topic, max_results, 'tech_en');
    return {
      results: [...cnResults, ...enResults].slice(0, max_results),
      topic,
      cn_count: cnResults.length,
      en_count: enResults.length
    };
  } catch (e) {
    return { error: e.message, results: [] };
  }
});

// 5. 获取网站当前状态
registerTool('get_site_status', '获取网站当前状态和数据', {
  type: 'object',
  properties: {}
}, async () => {
  const { getStats, getCategories, getPublishedPages, getAgentLogs } = require('../db/database');
  const stats = getStats();
  const categories = getCategories();
  const recentArticles = getPublishedPages(10);
  const recentLogs = getAgentLogs(10);
  return {
    stats,
    categories: categories.map(c => ({ name: c.name, slug: c.slug })),
    recent_articles: recentArticles.map(a => ({ title: a.title, views: a.view_count, category: a.category_name })),
    recent_logs: recentLogs.map(l => ({ role: l.agent_role, action: l.action, status: l.status })),
  };
});

// ============ 工具调用的 JSON Schema 供 AI 使用 ============
function getToolUsePrompt() {
  return `
你可以使用以下工具来获取信息和执行操作：

${Object.values(tools).map(t => `- **${t.name}**: ${t.description}`).join('\n')}

要使用工具，请在回复中包含一个 JSON 代码块：
\`\`\`tool_call
{"tool": "工具名称", "args": {"参数名": "参数值"}}
\`\`\`

工具结果会以如下格式返回给你：
\`\`\`tool_result
{"tool": "工具名称", "result": {...}}
\`\`\`

请根据需要主动使用工具来获取最新信息，不要仅凭已有知识回答。`;
}

// ============ 辅助函数 ============
function fetchUrl(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
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

async function fetchJson(url) {
  const text = await fetchUrl(url);
  return JSON.parse(text);
}

module.exports = { registerTool, getToolDefinitions, executeTool, getToolUsePrompt, tools };
