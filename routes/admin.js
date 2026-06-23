/**
 * 后台管理路由 v3 — 安全加固版
 * 随机 Session + bcrypt + CSRF + 登录限流 + 安全 Cookie
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getConfig, refreshConfig } = require('../config');
const db = require('../db/database');
const { testConnection } = require('../ai/client');

// ============ 常量 ============
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 小时
const loginAttempts = new Map(); // ip -> { count, lastAttempt }
const LOGIN_LIMIT = 5;
const LOGIN_LOCKOUT = 15 * 60 * 1000; // 15 分钟

// ============ 会话管理（持久化到数据库） ============
function createSession(ip) {
  // 清理过期会话
  const now = Date.now();
  const allSettings = db.getAllSettings();
  const sessionsRaw = allSettings._sessions || '{}';
  let sessions;
  try { sessions = JSON.parse(sessionsRaw); } catch { sessions = {}; }
  for (const [id, s] of Object.entries(sessions)) { if (now - s.created > SESSION_TTL) delete sessions[id]; }

  const id = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(32).toString('hex');
  sessions[id] = { created: now, ip, admin: true, csrf };
  db.setSetting('_sessions', JSON.stringify(sessions));
  return { id, csrf };
}

function getSession(sid) {
  if (!sid) return null;
  const sessionsRaw = db.getSetting('_sessions') || '{}';
  let sessions;
  try { sessions = JSON.parse(sessionsRaw); } catch { return null; }
  const s = sessions[sid];
  if (!s) return null;
  if (Date.now() - s.created > SESSION_TTL) { delete sessions[sid]; db.setSetting('_sessions', JSON.stringify(sessions)); return null; }
  return s;
}

function deleteSession(sid) {
  if (!sid) return;
  const sessionsRaw = db.getSetting('_sessions') || '{}';
  let sessions;
  try { sessions = JSON.parse(sessionsRaw); } catch { return; }
  delete sessions[sid];
  db.setSetting('_sessions', JSON.stringify(sessions));
}

function getSecureFlag(req) {
  return (req.secure || req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
}

// ============ Cookie 解析 ============
router.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(c => {
      const [key, val] = c.trim().split('=');
      if (key && val) req.cookies[key] = decodeURIComponent(val);
    });
  }
  next();
});

// ============ 会话中间件 ============
router.use((req, res, next) => {
  const sid = req.cookies?.admin_session;
  req.session = getSession(sid);
  req.sessionId = sid || null;
  next();
});

// ============ 登录认证中间件 ============
function requireAuth(req, res, next) {
  if (req.path === '/login' || req.path === '/setup') return next();
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

// ============ CSRF 验证中间件 ============
function requireCsrf(req, res, next) {
  // session 不存在或已过期 → 重新登录
  if (!req.session || !req.session.csrf) {
    return res.redirect('/admin/login');
  }
  const token = req.body?.csrf_token || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrf) {
    // CSRF 不匹配 → 可能是旧页面，重新登录
    return res.redirect('/admin/login');
  }
  next();
}

// 需要认证的路由
router.use(requireAuth);

// 注入 CSRF token 到所有模板
router.use((req, res, next) => {
  res.locals.csrfToken = req.session?.csrf || '';
  next();
});

// ============ 登录页面 ============
router.get('/login', (req, res) => {
  const admin = db.getAdmin();
  if (!admin.setup) return res.redirect('/admin/setup');
  res.render('admin/login', { title: '登录', error: req.query.error });
});

router.get('/setup', (req, res) => {
  const admin = db.getAdmin();
  if (admin.setup) return res.redirect('/admin/login');
  res.render('admin/setup', { title: '初始化设置', error: req.query.error });
});

router.post('/setup', (req, res) => {
  const { password, password2 } = req.body;
  if (!password || password.length < 4) return res.redirect('/admin/setup?error=' + encodeURIComponent('密码至少4位'));
  if (password !== password2) return res.redirect('/admin/setup?error=' + encodeURIComponent('两次密码不一致'));
  const hash = bcrypt.hashSync(password, 12);
  db.setAdminPassword(hash);
  const sess = createSession(req.ip);
  res.setHeader('Set-Cookie', `admin_session=${sess.id}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400${getSecureFlag(req)}`);
  res.redirect('/admin');
});

// ============ 登录（限流 + bcrypt 兼容 SHA-256）============
router.post('/login', (req, res) => {
  const ip = req.ip;
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.count >= LOGIN_LIMIT && Date.now() - attempt.lastAttempt < LOGIN_LOCKOUT) {
    return res.redirect('/admin/login?error=' + encodeURIComponent('登录尝试过多，请 15 分钟后重试'));
  }

  const { password } = req.body;
  const admin = db.getAdmin();
  let authenticated = false;

  // 先尝试 bcrypt
  if (admin.password && admin.password.startsWith('$2')) {
    try { authenticated = bcrypt.compareSync(password || '', admin.password); } catch {}
  }

  // 兼容旧的 SHA-256
  if (!authenticated) {
    const sha256 = crypto.createHash('sha256').update(password || '').digest('hex');
    if (sha256 === admin.password) {
      authenticated = true;
      // 自动升级为 bcrypt
      try { db.setAdminPassword(bcrypt.hashSync(password, 12)); } catch {}
    }
  }

  if (authenticated) {
    loginAttempts.delete(ip);
    const sess = createSession(req.ip);
    res.setHeader('Set-Cookie', `admin_session=${sess.id}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400${getSecureFlag(req)}`);
    res.redirect('/admin');
  } else {
    const a = loginAttempts.get(ip) || { count: 0 };
    loginAttempts.set(ip, { count: a.count + 1, lastAttempt: Date.now() });
    res.redirect('/admin/login?error=' + encodeURIComponent('密码错误'));
  }
});

// ============ 登出 ============
router.get('/logout', (req, res) => {
  deleteSession(req.sessionId);
  res.setHeader('Set-Cookie', `admin_session=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${getSecureFlag(req)}`);
  res.redirect('/admin/login');
});

// ============ 仪表盘 ============
router.get('/', (req, res) => {
  const stats = db.getStats();
  const agentLogs = db.getAgentLogs(30);
  const agentStatuses = db.getAgentStatuses();
  const schedules = db.getSchedules();
  let outage = { active: false };
  try { outage = require('../ai/client').getOutageStatus(); } catch {}
  let rageStatus = { active: false, level: 3 };
  try { rageStatus = require('../scheduler').getRageModeStatus(); } catch {}
  const workMode = getConfig().work_mode || 'smart';
  res.render('admin/dashboard', { title: '控制面板', stats, agentLogs, agentStatuses, schedules, outage, rageStatus, workMode, getConfig, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

// ============ 系统设置 ============
router.get('/settings', (req, res) => {
  const config = getConfig();
  res.render('admin/settings', { title: '系统设置', config, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.post('/settings', requireCsrf, (req, res) => {
  try {
    const fields = ['site_title', 'site_description', 'site_theme', 'site_direction', 'site_language', 'site_url', 'tavily_api_key'];
    for (const field of fields) { if (req.body[field] !== undefined) db.setSetting(field, req.body[field]); }
    refreshConfig();
    res.redirect('/admin/settings?success=1');
  } catch (err) { res.redirect('/admin/settings?error=' + encodeURIComponent(err.message)); }
});

// 修改密码
router.post('/change-password', requireCsrf, (req, res) => {
  const { old_password, new_password } = req.body;
  const admin = db.getAdmin();
  let oldOk = false;
  if (admin.password && admin.password.startsWith('$2')) {
    try { oldOk = bcrypt.compareSync(old_password || '', admin.password); } catch {}
  }
  if (!oldOk) {
    const sha256 = crypto.createHash('sha256').update(old_password || '').digest('hex');
    oldOk = sha256 === admin.password;
  }
  if (!oldOk) return res.redirect('/admin/settings?error=' + encodeURIComponent('原密码错误'));
  if (!new_password || new_password.length < 4) return res.redirect('/admin/settings?error=' + encodeURIComponent('新密码至少4位'));
  db.setAdminPassword(bcrypt.hashSync(new_password, 12));
  res.redirect('/admin/settings?success=' + encodeURIComponent('密码已修改'));
});

// 切换自动循环
router.post('/toggle-loop', requireCsrf, (req, res) => {
  const config = getConfig();
  const newState = config.ai_loop_enabled === '1' ? '0' : '1';
  db.setSetting('ai_loop_enabled', newState);
  refreshConfig();
  if (newState === '1') { try { const { startScheduler } = require('../scheduler'); startScheduler(); } catch {} }
  res.redirect('/admin?success=' + encodeURIComponent(newState === '1' ? '自动循环已开启' : '自动循环已关闭'));
});

// ============ 工作模式切换 ============
router.post('/work-mode', requireCsrf, (req, res) => {
  const mode = req.body.work_mode === 'rage' ? 'rage' : 'smart';
  const level = Math.max(1, Math.min(10, parseInt(req.body.rage_level) || 3));
  db.setSetting('work_mode', mode);
  db.setSetting('rage_level', String(level));
  refreshConfig();

  // 重启调度器以应用新模式
  try {
    const { stopScheduler, startScheduler, startRageMode } = require('../scheduler');
    stopScheduler();
    if (mode === 'rage') {
      startRageMode(level);
      res.redirect('/admin/settings?success=' + encodeURIComponent(`🔥 狂暴模式已启动！档位 ${level}，${level} 路并发`));
    } else {
      startScheduler();
      res.redirect('/admin/settings?success=' + encodeURIComponent('🧠 智能模式已恢复'));
    }
  } catch (err) {
    res.redirect('/admin/settings?error=' + encodeURIComponent(err.message));
  }
});

// ============ AI 提供商管理 ============
router.get('/providers', (req, res) => {
  const providers = db.getAIProviders();
  res.render('admin/providers', { title: 'AI 提供商', providers, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.post('/providers/add', requireCsrf, async (req, res) => {
  const { name, base_url, api_key, model } = req.body;
  if (!name || !base_url || !api_key || !model) return res.redirect('/admin/providers?error=' + encodeURIComponent('请填写完整信息'));
  db.addAIProvider({ name, base_url, api_key: api_key.trim(), model: model.trim() });
  refreshConfig();
  res.redirect('/admin/providers?success=' + encodeURIComponent(`提供商 "${name}" 已添加`));
});

router.post('/providers/:id/edit', requireCsrf, (req, res) => {
  const id = parseInt(req.params.id);
  const { name, base_url, api_key, model } = req.body;
  if (!name || !base_url || !api_key || !model) return res.redirect('/admin/providers?error=' + encodeURIComponent('请填写完整信息'));
  db.updateAIProvider(id, { name, base_url, api_key: api_key.trim(), model: model.trim() });
  refreshConfig();
  res.redirect('/admin/providers?success=' + encodeURIComponent(`提供商 "${name}" 已更新`));
});

router.post('/providers/:id/toggle', requireCsrf, (req, res) => {
  const id = parseInt(req.params.id);
  const provider = db.getAIProviders().find(p => p.id === id);
  if (provider) db.updateAIProvider(id, { enabled: !provider.enabled });
  res.redirect('/admin/providers');
});

router.post('/providers/:id/delete', requireCsrf, (req, res) => {
  db.deleteAIProvider(parseInt(req.params.id));
  res.redirect('/admin/providers?success=1');
});

router.post('/providers/:id/test', requireCsrf, async (req, res) => {
  const provider = db.getAIProviders().find(p => p.id === parseInt(req.params.id));
  if (!provider) return res.json({ success: false, error: '提供商不存在' });
  const result = await testConnection(provider);
  res.json(result);
});

// ============ 分类 CRUD ============
router.get('/categories', (req, res) => {
  const categories = db.getCategories();
  const allPages = db.getAllPages();
  // 统计每个栏目的文章数
  const countMap = {};
  allPages.forEach(p => { if (p.category_id) countMap[p.category_id] = (countMap[p.category_id] || 0) + 1; });
  categories.forEach(c => { c.article_count = countMap[c.id] || 0; });
  res.render('admin/categories', { title: '栏目管理', categories, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.post('/categories/add', requireCsrf, (req, res) => {
  const { name, slug, description, sort_order } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/categories?error=' + encodeURIComponent('请输入栏目名称'));
  const finalSlug = slug?.trim() || name.trim().toLowerCase().replace(/[\s]+/g, '-').replace(/[^a-z0-9一-龥-]/g, '');
  if (!finalSlug) return res.redirect('/admin/categories?error=' + encodeURIComponent('URL标识不能为空'));
  const existing = db.getCategoryBySlug(finalSlug);
  if (existing) return res.redirect('/admin/categories?error=' + encodeURIComponent('URL标识已存在: ' + finalSlug));
  db.addCategory(name.trim(), finalSlug, description?.trim(), parseInt(sort_order) || 0);
  res.redirect('/admin/categories?success=1');
});

router.post('/categories/:id/edit', requireCsrf, (req, res) => {
  const { name, slug, description, sort_order } = req.body;
  db.updateCategory(parseInt(req.params.id), { name, slug, description, sort_order: parseInt(sort_order) || 0 });
  res.redirect('/admin/categories?success=1');
});

router.post('/categories/:id/delete', requireCsrf, (req, res) => {
  db.deleteCategory(parseInt(req.params.id));
  res.redirect('/admin/categories?success=1');
});

// ============ 文章 CRUD ============
router.get('/articles', (req, res) => {
  const status = req.query.status || null;
  const q = (req.query.q || '').trim();
  const sort = req.query.sort || 'newest';
  const cat = req.query.cat || '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;

  let allPages = db.getAllPages(status);

  // 栏目筛选
  if (cat) {
    const catId = parseInt(cat);
    if (catId) allPages = allPages.filter(p => p.category_id === catId);
  }

  // 关键词搜索
  if (q) {
    const qLower = q.toLowerCase();
    allPages = allPages.filter(p =>
      (p.title || '').toLowerCase().includes(qLower) ||
      (p.summary || '').toLowerCase().includes(qLower) ||
      (p.seo_keywords || '').toLowerCase().includes(qLower)
    );
  }

  // 排序
  if (sort === 'views') {
    allPages.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  } else if (sort === 'oldest') {
    allPages.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  } else {
    allPages.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }

  const total = allPages.length;
  const totalPages = Math.ceil(total / limit);
  const pages = allPages.slice((page - 1) * limit, page * limit);
  const categories = db.getCategories();
  res.render('admin/articles', { title: '文章管理', pages, status, q, sort, cat, page, totalPages, total, categories, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.get('/articles/new', (req, res) => {
  const categories = db.getCategories();
  res.render('admin/article-edit', { title: '新建文章', article: null, categories, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.get('/articles/:id/edit', (req, res) => {
  const article = db.getPageById(parseInt(req.params.id));
  if (!article) return res.redirect('/admin/articles?error=' + encodeURIComponent('文章不存在'));
  const categories = db.getCategories();
  res.render('admin/article-edit', { title: '编辑文章', article, categories, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.post('/articles/save', requireCsrf, (req, res) => {
  const { id, title, slug, category_id, summary, content_md, status, seo_title, seo_description, seo_keywords, featured } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin/articles?error=' + encodeURIComponent('标题不能为空'));
  const finalSlug = slug?.trim() || require('../ai/utils').slugify(title.trim());
  if (!finalSlug) return res.redirect('/admin/articles?error=' + encodeURIComponent('URL标识不能为空'));
  const existing = db.getPageBySlug(finalSlug);
  if (existing && (!id || existing.id !== parseInt(id))) {
    return res.redirect('/admin/articles?error=' + encodeURIComponent('URL标识已存在: ' + finalSlug));
  }
  const { marked } = require('marked');
  const raw_html = marked(content_md || '');
  const { createDOMPurify } = require('../ai/utils');
  const DOMPurify = createDOMPurify();
  const content_html = DOMPurify.sanitize(raw_html);
  const now = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  let published_at = null;
  if (status === 'published') {
    if (id) {
      const existingArticle = db.getPageById(parseInt(id));
      published_at = (existingArticle && existingArticle.published_at) ? existingArticle.published_at : now();
    } else {
      published_at = now();
    }
  }
  const pageData = { title: title.trim(), slug: finalSlug, category_id: category_id ? parseInt(category_id) : null, summary: summary?.trim(), content_md: content_md || '', content_html, status: status || 'draft', seo_title: seo_title?.trim(), seo_description: seo_description?.trim(), seo_keywords: seo_keywords?.trim(), featured: featured === 'on' ? 1 : 0, published_at };
  if (id) { db.updatePage(parseInt(id), pageData); } else { db.insertPage(pageData); }
  res.redirect('/admin/articles?success=1');
});

router.post('/articles/:id/delete', requireCsrf, (req, res) => {
  db.deletePage(parseInt(req.params.id));
  res.redirect('/admin/articles?success=1');
});

router.post('/articles/:id/status', requireCsrf, (req, res) => {
  const { status } = req.body;
  const updates = { status };
  if (status === 'published') updates.published_at = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  db.updatePage(parseInt(req.params.id), updates);
  res.redirect('/admin/articles?success=1');
});

// AI 润色文章
router.post('/articles/:id/polish', requireCsrf, async (req, res) => {
  try {
    const article = db.getPageById(parseInt(req.params.id));
    if (!article) return res.redirect('/admin/articles?error=' + encodeURIComponent('文章不存在'));
    const { callAIForJSON } = require('../ai/client');
    db.logAgent('editor', '润色文章', 'running', `润色: ${article.title}`);
    const { data } = await callAIForJSON([
      { role: 'system', content: '你是专业的内容编辑。请润色以下文章，使其更专业、更有深度、更易读。保持原文结构和核心观点，但提升文字质量和信息密度。以 JSON 格式返回。' },
      { role: 'user', content: `请润色以下文章（当前日期：${new Date().toLocaleDateString('zh-CN')}）：\n\n标题：${article.title}\n\n${article.content_md}\n\n返回 JSON: {"title":"润色后标题","summary":"润色后摘要","content_md":"润色后全文","seo_title":"SEO标题","seo_description":"SEO描述"}` }
    ], { maxTokens: 8192 });
    const { marked } = require('marked');
    const { createDOMPurify } = require('../ai/utils');
    const DOMPurify = createDOMPurify();
    db.updatePage(article.id, { title: data.title || article.title, summary: data.summary || article.summary, content_md: data.content_md || article.content_md, content_html: DOMPurify.sanitize(marked(data.content_md || article.content_md)), seo_title: data.seo_title || article.seo_title, seo_description: data.seo_description || article.seo_description });
    db.logAgent('editor', '润色文章', 'success', `完成: ${article.title}`);
    res.redirect('/admin/articles/' + article.id + '/edit?success=' + encodeURIComponent('润色完成'));
  } catch (err) {
    db.logAgent('editor', '润色文章', 'failed', err.message);
    res.redirect('/admin/articles?error=' + encodeURIComponent('润色失败: ' + err.message));
  }
});

// ============ 定时任务管理 ============
router.get('/schedules', (req, res) => {
  const schedules = db.getSchedules();
  res.render('admin/schedules', { title: '定时任务', schedules, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.post('/schedules/:id/toggle', requireCsrf, (req, res) => {
  const schedule = db.getSchedules().find(s => s.id === parseInt(req.params.id));
  if (schedule) db.updateSchedule(schedule.id, { enabled: schedule.enabled ? 0 : 1 });
  res.redirect('/admin/schedules');
});

router.post('/schedules/add', requireCsrf, (req, res) => {
  const { task_type, cron_expr, description } = req.body;
  if (!task_type || !cron_expr) return res.redirect('/admin/schedules?error=' + encodeURIComponent('请填写完整'));
  db.addSchedule(task_type, cron_expr, description || task_type);
  res.redirect('/admin/schedules?success=1');
});

router.post('/schedules/:id/delete', requireCsrf, (req, res) => {
  db.deleteSchedule(parseInt(req.params.id));
  res.redirect('/admin/schedules?success=1');
});

// ============ Agent 日志 ============
router.get('/logs', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 30;
  const allLogs = db.getAgentLogs(9999);
  const total = allLogs.length;
  const totalPages = Math.ceil(total / limit);
  const logs = allLogs.slice((page - 1) * limit, page * limit);
  const agentStatuses = db.getAgentStatuses();
  res.render('admin/logs', { title: 'Agent 日志', logs, agentStatuses, page, totalPages, total, csrfToken: req.session?.csrf || '' });
});

// ============ 手动触发 ============
router.post('/trigger/:taskType', requireCsrf, async (req, res) => {
  const { taskType } = req.params;
  try {
    if (db.getAIProviders().filter(p => p.enabled).length === 0) return res.redirect('/admin?error=' + encodeURIComponent('请先添加 AI 提供商'));
    const { executeTask } = require('../scheduler');
    executeTask(taskType).catch(err => console.error(`任务 ${taskType} 失败:`, err));
    res.redirect('/admin?success=' + encodeURIComponent(`任务 ${taskType} 已触发`));
  } catch (err) { res.redirect('/admin?error=' + encodeURIComponent(err.message)); }
});

// ============ 冷启动 / 清除 ============
router.post('/cold-start', requireCsrf, async (req, res) => {
  if (db.getAIProviders().filter(p => p.enabled).length === 0) return res.redirect('/admin?error=' + encodeURIComponent('请先添加 AI 提供商'));
  try { const { coldStart } = require('../scheduler'); coldStart().catch(err => console.error('冷启动失败:', err)); res.redirect('/admin?success=' + encodeURIComponent('冷启动已触发，正在生成初始内容...')); } catch (err) { res.redirect('/admin?error=' + encodeURIComponent(err.message)); }
});

router.post('/clear-content', requireCsrf, async (req, res) => {
  try {
    db.clearAllContent();
    refreshConfig();
    const { coldStart } = require('../scheduler');
    coldStart().catch(err => console.error('重新生成失败:', err));
    res.redirect('/admin?success=' + encodeURIComponent('已清除旧内容，正在重新生成...'));
  } catch (err) { res.redirect('/admin?error=' + encodeURIComponent(err.message)); }
});

// ============ 广告管理 ============
router.get('/ads', (req, res) => {
  const ads = db.getAds();
  res.render('admin/ads', { title: '广告管理', ads, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.post('/ads/add', requireCsrf, (req, res) => {
  const { title, content, image_url, link_url, position, sort_order } = req.body;
  if (!title) return res.redirect('/admin/ads?error=' + encodeURIComponent('请输入广告标题'));
  db.addAd({ title, content, image_url, link_url, position, sort_order: parseInt(sort_order) || 0 });
  res.redirect('/admin/ads?success=1');
});

router.post('/ads/:id/edit', requireCsrf, (req, res) => {
  const id = parseInt(req.params.id);
  const { title, content, image_url, link_url, position, sort_order, enabled } = req.body;
  db.updateAd(id, { title, content, image_url, link_url, position, sort_order: parseInt(sort_order) || 0, enabled: enabled === 'on' });
  res.redirect('/admin/ads?success=1');
});

router.post('/ads/:id/toggle', requireCsrf, (req, res) => {
  const id = parseInt(req.params.id);
  const ad = db.getAds().find(a => a.id === id);
  if (ad) db.updateAd(id, { enabled: !ad.enabled });
  res.redirect('/admin/ads');
});

router.post('/ads/:id/delete', requireCsrf, (req, res) => {
  db.deleteAd(parseInt(req.params.id));
  res.redirect('/admin/ads?success=1');
});

// ============ 友情链接管理 ============
router.get('/friend-links', (req, res) => {
  const links = db.getFriendLinks();
  res.render('admin/friend-links', { title: '友情链接', links, csrfToken: req.session?.csrf || '', success: req.query.success, error: req.query.error });
});

router.post('/friend-links/add', requireCsrf, (req, res) => {
  const { name, url, logo_url, description, sort_order } = req.body;
  if (!name || !url) return res.redirect('/admin/friend-links?error=' + encodeURIComponent('请输入名称和链接'));
  db.addFriendLink({ name, url, logo_url, description, sort_order: parseInt(sort_order) || 0 });
  res.redirect('/admin/friend-links?success=1');
});

router.post('/friend-links/:id/edit', requireCsrf, (req, res) => {
  const id = parseInt(req.params.id);
  const { name, url, logo_url, description, sort_order, enabled } = req.body;
  db.updateFriendLink(id, { name, url, logo_url, description, sort_order: parseInt(sort_order) || 0, enabled: enabled === 'on' });
  res.redirect('/admin/friend-links?success=1');
});

router.post('/friend-links/:id/toggle', requireCsrf, (req, res) => {
  const id = parseInt(req.params.id);
  const link = db.getFriendLinks().find(l => l.id === id);
  if (link) db.updateFriendLink(id, { enabled: !link.enabled });
  res.redirect('/admin/friend-links');
});

router.post('/friend-links/:id/delete', requireCsrf, (req, res) => {
  db.deleteFriendLink(parseInt(req.params.id));
  res.redirect('/admin/friend-links?success=1');
});

module.exports = router;
