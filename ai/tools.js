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

// 1. 网页搜索（通过多搜索引擎 + Tavily）
registerTool('web_search', '搜索互联网获取最新信息，支持任意主题', {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索关键词' },
    max_results: { type: 'number', description: '最大结果数', default: 5 }
  },
  required: ['query']
}, async ({ query, max_results = 5 }) => {
  const { searchWeb } = require('./search');
  const results = await searchWeb(query, max_results);
  return { results, query, count: results.length };
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
  // SSRF 防护：禁止访问内网地址
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const isPrivate = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/i.test(hostname);
    if (isPrivate) {
      return { url, error: '禁止访问内网地址' };
    }
  } catch (e) {
    return { url, error: '无效的 URL: ' + e.message };
  }
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

// 3. 获取最新热点新闻（根据网站主题自动搜索）
registerTool('get_latest_news', '获取与网站主题相关的最新热点新闻', {
  type: 'object',
  properties: {
    max_results: { type: 'number', description: '最大结果数', default: 10 }
  }
}, async ({ max_results = 10 }) => {
  const { getLatestNews } = require('./search');
  const news = await getLatestNews(max_results);
  return { news, count: news.length };
});

// 4. 搜索特定话题新闻
registerTool('search_topic_news', '搜索特定话题的最新新闻（自动结合网站主题）', {
  type: 'object',
  properties: {
    topic: { type: 'string', description: '搜索话题' },
    max_results: { type: 'number', description: '最大结果数', default: 5 }
  },
  required: ['topic']
}, async ({ topic, max_results = 5 }) => {
  const { searchWeb } = require('./search');
  const results = await searchWeb(topic, max_results);
  return { results, topic, count: results.length };
});

// 5. 添加 RSS 源（AI 发现并保存跟网站主题相关的源）
registerTool('add_rss_feed', '发现并添加一个与网站主题相关的 RSS 源，后续自动采信', {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'RSS 源的 URL' },
    reason: { type: 'string', description: '为什么要添加这个源（如：该源覆盖XX领域，与网站主题匹配）' }
  },
  required: ['url', 'reason']
}, async ({ url, reason }) => {
  const { discoverFeed, getManagedFeeds } = require('./search');
  await discoverFeed(url, reason);
  const feeds = getManagedFeeds();
  return { success: true, total_feeds: feeds.length, added: url, reason };
});

// 6. 查看已管理的 RSS 源
registerTool('list_rss_feeds', '查看当前已添加的所有 RSS 源', {
  type: 'object', properties: {}
}, async () => {
  const { getManagedFeeds } = require('./search');
  return { feeds: getManagedFeeds() };
});

// 7. 获取网站当前状态
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
