/**
 * 数据库封装 - 纯 JSON 文件数据库 v2
 * 支持多 Agent 系统、多 AI 提供商、管理日志
 *
 * 优化:
 *   - A) async mutex 并发写入保护
 *   - B) saveDb() 异步写入 (fs.promises.writeFile)
 *   - C) getCategories / getStats 缓存层 (TTL)
 *   - D) getAnalyticsSummary Map 索引优化
 *   - E) analytics 数据归档 (上限 10000, 保留最近 5000)
 *   - F) event_type 白名单校验
 */
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
let data = null;
let saveTimer = null;

// ============ A) 并发写入保护 (async mutex) ============
let _writeLock = Promise.resolve();

/**
 * 获取写锁，返回 release 函数。
 * 用法: const release = await acquireLock(); try { ... } finally { release(); }
 */
function acquireLock() {
  let release;
  const p = new Promise(resolve => { release = resolve; });
  const prev = _writeLock;
  _writeLock = p;
  return prev.then(() => release);
}

/**
 * 包装器：在写锁内执行异步函数 fn，完成后自动释放锁。
 */
async function withLock(fn) {
  const release = await acquireLock();
  try {
    return await fn();
  } finally {
    release();
  }
}

// ============ C) 缓存层 ============
const _cache = {
  categories: { data: null, ts: 0 },
  stats: { data: null, ts: 0 },
};
const CATEGORIES_TTL = 5000;  // 5 秒
const STATS_TTL = 10000;      // 10 秒

function _invalidateCache() {
  _cache.categories.ts = 0;
  _cache.stats.ts = 0;
}

// ============ E+F) Analytics 常量 ============
const ANALYTICS_MAX = 10000;
const ANALYTICS_KEEP = 5000;
const ALLOWED_EVENT_TYPES = new Set(['pageview', 'time_on_page', 'scroll_depth']);

const DEFAULT_DATA = {
  // 管理员账户
  admin: { password: '', setup: false },

  // AI 提供商列表（支持多个、备用、负载均衡）
  ai_providers: [],

  // 网站设置
  settings: {
    site_title: 'AI 智能网站',
    site_description: '由 AI 全自动维护的高质量内容网站',
    site_theme: '',
    site_direction: '',
    site_language: 'zh-CN',
    site_url: 'http://localhost:3000',
    ai_loop_enabled: '0',
    content_plan: '',
    last_strategy_notes: '',
  },

  // 分类
  categories: [],

  // 文章/页面
  pages: [],

  // AI Agent 执行日志（详细记录每个 Agent 的工作）
  agent_logs: [],

  // 定时任务
  schedule: [
    { id: 1, task_type: 'news_collector', cron_expr: '0 7,12,18 * * *', description: '每天 7/12/18 点采集资讯', enabled: 1, last_run: null },
    { id: 2, task_type: 'plan_structure', cron_expr: '0 7 1,15 * *', description: '每月1/15日 7:00 结构规划', enabled: 1, last_run: null },
    { id: 3, task_type: 'generate_content', cron_expr: '0 8,11,14,17,20,23 * * *', description: '每天 8/11/14/17/20/23 点生成文章', enabled: 1, last_run: null },
    { id: 4, task_type: 'heartbeat', cron_expr: '*/30 * * * *', description: '每30分钟检查补充内容', enabled: 1, last_run: null },
    { id: 5, task_type: 'seo_update', cron_expr: '0 2 * * *', description: '每天 2:00 SEO 更新', enabled: 1, last_run: null },
    { id: 6, task_type: 'seo_expert_audit', cron_expr: '0 3 * * 1', description: '每周一 3:00 SEO 深度审计', enabled: 1, last_run: null },
    { id: 7, task_type: 'analyze', cron_expr: '30 22 * * *', description: '每天 22:30 数据分析', enabled: 1, last_run: null },
    { id: 8, task_type: 'user_test', cron_expr: '0 4 * * 3', description: '每周三 4:00 用户体验测评', enabled: 1, last_run: null },
    { id: 9, task_type: 'template_review', cron_expr: '0 4 * * 0', description: '每周日 4:00 模板审查', enabled: 1, last_run: null },
  ],

  // 分析数据
  analytics: [],

  // 模板历史
  template_history: [],

  // 当前运行状态
  agent_status: {},

  // ID 计数器
  _counters: { categories: 0, pages: 0, agent_logs: 0, analytics: 0, template_history: 0, ai_providers: 0 },
};

async function initDb() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    try { data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { data = JSON.parse(JSON.stringify(DEFAULT_DATA)); }
  } else {
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  // 补充缺失字段
  for (const key of Object.keys(DEFAULT_DATA)) {
    if (!(key in data)) data[key] = DEFAULT_DATA[key];
  }
  if (!data._counters) data._counters = DEFAULT_DATA._counters;
  if (!data.admin) data.admin = { password: '', setup: false };
  if (!data.ai_providers) data.ai_providers = [];
  if (!data.agent_logs) data.agent_logs = [];
  if (!data.agent_status) data.agent_status = {};
  // 初始化所有 Agent 状态（确保面板显示完整）
  const ALL_AGENTS = ['site_manager', 'planner', 'news_collector', 'writer', 'reviewer', 'editor', 'seo_expert', 'user_tester', 'analyzer', 'technician'];
  for (const role of ALL_AGENTS) {
    if (!data.agent_status[role]) {
      data.agent_status[role] = { status: 'idle', current_task: null, updated_at: null };
    }
  }

  return data;
}

function getDb() { if (!data) throw new Error('数据库未初始化'); return data; }

// ============ B) saveDb 异步写入 ============
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    _invalidateCache();  // C) 缓存失效
    await saveDbAsync();
  }, 1000);
}

/** 异步写入（常规路径） */
async function saveDbAsync() {
  if (!data) return;
  try {
    await fs.promises.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('数据库保存失败:', err.message);
  }
}

/** 同步写入（仅用于 process.on('exit')，exit handler 不能用 async） */
function saveDb() {
  if (!data) return;
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (err) { console.error('数据库保存失败:', err.message); }
}

function nextId(counter) { data._counters[counter] = (data._counters[counter] || 0) + 1; return data._counters[counter]; }
function now() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
}

// ============ 管理员 ============
function getAdmin() { return getDb().admin; }
function setAdminPassword(password) {
  return withLock(() => { getDb().admin = { password, setup: true }; scheduleSave(); });
}

// ============ AI 提供商 ============
function getAIProviders() { return getDb().ai_providers; }
function getActiveAIProvider() {
  const providers = getDb().ai_providers.filter(p => p.enabled);
  if (providers.length === 0) return null;
  // 轮询负载均衡：选择最少使用的
  providers.sort((a, b) => (a.request_count || 0) - (b.request_count || 0));
  return providers[0];
}
function addAIProvider(provider) {
  return withLock(() => {
    const id = nextId('ai_providers');
    getDb().ai_providers.push({ id, name: provider.name, base_url: provider.base_url, api_key: provider.api_key, model: provider.model, enabled: true, request_count: 0, error_count: 0, created_at: now() });
    scheduleSave();
    return id;
  });
}
function updateAIProvider(id, updates) {
  return withLock(() => {
    const p = getDb().ai_providers.find(p => p.id === id);
    if (p) { Object.assign(p, updates); scheduleSave(); }
  });
}
function deleteAIProvider(id) {
  return withLock(() => {
    getDb().ai_providers = getDb().ai_providers.filter(p => p.id !== id);
    scheduleSave();
  });
}
function incrementProviderUsage(id, success) {
  const p = getDb().ai_providers.find(p => p.id === id);
  if (p) { p.request_count = (p.request_count || 0) + 1; if (!success) p.error_count = (p.error_count || 0) + 1; scheduleSave(); }
}

// ============ 设置 ============
function getSetting(key) { return getDb().settings[key] ?? null; }
function setSetting(key, value) {
  return withLock(() => { getDb().settings[key] = String(value); scheduleSave(); });
}
function getAllSettings() { return { ...getDb().settings }; }

// ============ Agent 日志 ============
function logAgent(agentRole, action, status, detail, meta) {
  return withLock(() => {
    const log = { id: nextId('agent_logs'), agent_role: agentRole, action, status, detail: detail || '', meta: meta || null, created_at: now() };
    getDb().agent_logs.push(log);
    // 保留最近 500 条
    if (getDb().agent_logs.length > 500) getDb().agent_logs = getDb().agent_logs.slice(-500);
    scheduleSave();
    return log.id;
  });
}
function updateAgentStatus(agentRole, status, currentTask) {
  return withLock(() => {
    getDb().agent_status[agentRole] = { status, current_task: currentTask, updated_at: now() };
    scheduleSave();
  });
}
function getAgentLogs(limit = 50) { return getDb().agent_logs.slice(-limit).reverse(); }
function getAgentStatuses() { return getDb().agent_status; }

// ============ 分类 ============
function getCategories() {
  const nowTs = Date.now();
  if (_cache.categories.data && (nowTs - _cache.categories.ts) < CATEGORIES_TTL) {
    return _cache.categories.data;
  }
  const result = getDb().categories.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  _cache.categories = { data: result, ts: nowTs };
  return result;
}
function getCategoryBySlug(slug) { return getDb().categories.find(c => c.slug === slug) || null; }
function getCategoryById(id) { return getDb().categories.find(c => c.id === id) || null; }
function upsertCategory(slug, name, description, sortOrder, parentId) {
  return withLock(() => {
    const db = getDb();
    const existing = db.categories.find(c => c.slug === slug);
    if (existing) {
      existing.name = name; existing.description = description || ''; existing.sort_order = sortOrder || 0; existing.parent_id = parentId || null; existing.updated_at = now();
    } else {
      db.categories.push({ id: nextId('categories'), slug, name, description: description || '', sort_order: sortOrder || 0, parent_id: parentId || null, created_at: now(), updated_at: now() });
    }
    scheduleSave();
  });
}
function addCategory(name, slug, description, sortOrder) {
  return withLock(() => {
    const id = nextId('categories');
    getDb().categories.push({ id, slug: slug || name.toLowerCase().replace(/\s+/g, '-'), name, description: description || '', sort_order: sortOrder || 0, parent_id: null, created_at: now(), updated_at: now() });
    scheduleSave();
    return id;
  });
}
function updateCategory(id, updates) {
  return withLock(() => {
    const cat = getDb().categories.find(c => c.id === id);
    if (cat) { Object.assign(cat, updates); cat.updated_at = now(); scheduleSave(); }
  });
}
function deleteCategory(id) {
  return withLock(() => {
    getDb().categories = getDb().categories.filter(c => c.id !== id);
    // 将该分类下的文章设为未分类
    getDb().pages.filter(p => p.category_id === id).forEach(p => p.category_id = null);
    scheduleSave();
  });
}

// ============ 文章/页面 ============
function enrichPage(page) {
  const cats = getDb().categories;
  const cat = page.category_id ? cats.find(c => c.id === page.category_id) : null;
  return { ...page, category_name: cat?.name || null, category_slug: cat?.slug || null };
}

function getPublishedPages(limit = 50, offset = 0, categoryId = null) {
  let pages = getDb().pages.filter(p => p.status === 'published');
  if (categoryId) pages = pages.filter(p => p.category_id === categoryId);
  pages.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  return pages.slice(offset, offset + limit).map(enrichPage);
}

function getPageBySlug(slug) { const page = getDb().pages.find(p => p.slug === slug); return page ? enrichPage(page) : null; }
function getPageById(id) { const page = getDb().pages.find(p => p.id === id); return page ? enrichPage(page) : null; }

function getAllPages(status) {
  let pages = getDb().pages.slice();
  if (status) pages = pages.filter(p => p.status === status);
  pages.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return pages.map(enrichPage);
}

function getPlannedPages(limit = 5) { return getDb().pages.filter(p => p.status === 'planned').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).slice(0, limit); }

function insertPage(page) {
  return withLock(() => {
    const id = nextId('pages');
    const nowStr = now();
    getDb().pages.push({
      id, slug: page.slug, title: page.title, category_id: page.category_id || null,
      template: page.template || 'article', summary: page.summary || '',
      content_md: page.content_md || '', content_html: page.content_html || '',
      cover_image: page.cover_image || null, status: page.status || 'draft',
      featured: page.featured || 0, view_count: 0,
      seo_title: page.seo_title || null, seo_description: page.seo_description || null,
      seo_keywords: page.seo_keywords || null, schema_json: page.schema_json || null,
      published_at: page.published_at || null, created_at: nowStr, updated_at: nowStr,
    });
    scheduleSave();
    return id;
  });
}

function updatePage(id, updates) {
  return withLock(() => {
    const page = getDb().pages.find(p => p.id === id);
    if (page) { Object.assign(page, updates); page.updated_at = now(); scheduleSave(); }
  });
}

function deletePage(id) {
  return withLock(() => {
    getDb().pages = getDb().pages.filter(p => p.id !== id);
    scheduleSave();
  });
}

function getStats() {
  const nowTs = Date.now();
  if (_cache.stats.data && (nowTs - _cache.stats.ts) < STATS_TTL) {
    return _cache.stats.data;
  }
  const db = getDb();
  const nowStr = now().split(' ')[0];
  const result = {
    totalArticles: db.pages.filter(p => p.status === 'published').length,
    totalDrafts: db.pages.filter(p => p.status === 'draft').length,
    totalPlanned: db.pages.filter(p => p.status === 'planned').length,
    totalCategories: db.categories.length,
    totalPageviews: db.analytics.filter(a => a.event_type === 'pageview').length,
    todayPageviews: db.analytics.filter(a => a.event_type === 'pageview' && a.created_at > nowStr).length,
    totalProviders: db.ai_providers.length,
    activeProviders: db.ai_providers.filter(p => p.enabled).length,
    totalAgentLogs: db.agent_logs.length,
    lastArticle: [...db.pages].reverse().find(p => p.status === 'published') || null,
  };
  _cache.stats = { data: result, ts: nowTs };
  return result;
}

// ============ 分析数据 ============
function recordAnalytics(input) {
  // F) event_type 白名单
  if (!ALLOWED_EVENT_TYPES.has(input.event_type)) return;

  return withLock(() => {
    const db = getDb();

    // E) 数据归档：超过上限时保留最近 N 条
    if (db.analytics.length >= ANALYTICS_MAX) {
      db.analytics = db.analytics.slice(-ANALYTICS_KEEP);
    }

    db.analytics.push({ id: nextId('analytics'), page_id: input.page_id || null, page_slug: input.page_slug, event_type: input.event_type, value: input.value || null, referrer: input.referrer || null, user_agent: input.user_agent || null, ip_hash: input.ip_hash || null, created_at: now() });
    if (input.event_type === 'pageview' && input.page_id) { const page = db.pages.find(p => p.id === input.page_id); if (page) page.view_count = (page.view_count || 0) + 1; }
    scheduleSave();
  });
}

// D) getAnalyticsSummary — 用 Map 索引优化 O(N×M) → O(N+M)
function getAnalyticsSummary(days = 30) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

  // 一次性构建 page_id -> analytics[] 索引
  const analyticsByPage = new Map();
  for (const a of db.analytics) {
    if (a.created_at > cutoff && a.page_id != null) {
      let arr = analyticsByPage.get(a.page_id);
      if (!arr) { arr = []; analyticsByPage.set(a.page_id, arr); }
      arr.push(a);
    }
  }

  return db.pages.filter(p => p.status === 'published').map(page => {
    const events = analyticsByPage.get(page.id) || [];
    const views = events.filter(a => a.event_type === 'pageview').length;
    const timeValues = events.filter(a => a.event_type === 'time_on_page' && a.value).map(a => a.value);
    const scrollValues = events.filter(a => a.event_type === 'scroll_depth' && a.value).map(a => a.value);
    return { slug: page.slug, title: page.title, category_id: page.category_id, status: page.status, views, avg_time: timeValues.length ? Math.round(timeValues.reduce((a, b) => a + b, 0) / timeValues.length * 10) / 10 : 0, avg_scroll: scrollValues.length ? Math.round(scrollValues.reduce((a, b) => a + b, 0) / scrollValues.length * 10) / 10 : 0, };
  }).sort((a, b) => b.views - a.views);
}

// ============ 调度 ============
function getSchedules() { return getDb().schedule; }
function updateScheduleLastRun(id) {
  return withLock(() => {
    const s = getDb().schedule.find(s => s.id === id);
    if (s) { s.last_run = now(); scheduleSave(); }
  });
}
function getScheduleByType(taskType) { return getDb().schedule.find(s => s.task_type === taskType) || null; }
function addSchedule(taskType, cronExpr, description) {
  return withLock(() => {
    const maxId = Math.max(0, ...getDb().schedule.map(s => s.id));
    getDb().schedule.push({ id: maxId + 1, task_type: taskType, cron_expr: cronExpr, description, enabled: 1, last_run: null });
    scheduleSave();
  });
}
function updateSchedule(id, updates) {
  return withLock(() => {
    const s = getDb().schedule.find(s => s.id === id);
    if (s) { Object.assign(s, updates); scheduleSave(); }
  });
}
function deleteSchedule(id) {
  return withLock(() => {
    getDb().schedule = getDb().schedule.filter(s => s.id !== id);
    scheduleSave();
  });
}

// ============ 模板历史 ============
function saveTemplateHistory(filePath, content, changeNote) {
  return withLock(() => {
    getDb().template_history.push({ id: nextId('template_history'), file_path: filePath, content, change_note: changeNote, created_at: now() });
    scheduleSave();
  });
}
function getLatestTemplateHistory(filePath) { const items = getDb().template_history.filter(h => h.file_path === filePath); return items.length > 0 ? items[items.length - 1] : null; }

// ============ 清除数据 ============
function clearAllContent() {
  return withLock(() => {
    const db = getDb();
    db.categories = []; db.pages = []; db.analytics = []; db.template_history = [];
    db._counters.categories = 0; db._counters.pages = 0; db._counters.analytics = 0; db._counters.template_history = 0;
    _invalidateCache();
    // 同步写入确保数据立即持久化
    saveDb();
  });
}

// exit handler 保持同步写入（exit handler 不能用 async）
process.on('exit', () => { try { saveDb(); } catch {} });

module.exports = {
  initDb, getDb, saveDb,
  getAdmin, setAdminPassword,
  getAIProviders, getActiveAIProvider, addAIProvider, updateAIProvider, deleteAIProvider, incrementProviderUsage,
  getSetting, setSetting, getAllSettings,
  logAgent, updateAgentStatus, getAgentLogs, getAgentStatuses,
  getCategories, getCategoryBySlug, getCategoryById, upsertCategory, addCategory, updateCategory, deleteCategory,
  getPublishedPages, getPageBySlug, getPageById, getAllPages, getPlannedPages, insertPage, updatePage, deletePage,
  enrichPage, getStats,
  recordAnalytics, getAnalyticsSummary,
  getSchedules, updateScheduleLastRun, getScheduleByType, addSchedule, updateSchedule, deleteSchedule,
  saveTemplateHistory, getLatestTemplateHistory, clearAllContent
};
