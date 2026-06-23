/**
 * 后台管理路由 v2
 * 登录认证、CRUD 管理、多提供商、Agent 日志
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getConfig, refreshConfig } = require('../config');
const db = require('../db/database');
const { testConnection } = require('../ai/client');

// ============ Cookie 解析（必须在最前面）============
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
  req.session = req.session || {};
  const sessionCookie = req.cookies?.admin_session;
  if (sessionCookie === 'authenticated') {
    req.session.admin = true;
  }
  next();
});

// ============ 登录认证中间件 ============
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (req.path === '/login' || req.path === '/setup') return next();
  return res.redirect('/admin/login');
}

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
  db.setAdminPassword(crypto.createHash('sha256').update(password).digest('hex'));
  res.setHeader('Set-Cookie', 'admin_session=authenticated; Path=/admin; HttpOnly; Max-Age=86400');
  res.redirect('/admin');
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const admin = db.getAdmin();
  const hash = crypto.createHash('sha256').update(password || '').digest('hex');
  if (hash === admin.password) {
    res.setHeader('Set-Cookie', 'admin_session=authenticated; Path=/admin; HttpOnly; Max-Age=86400');
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=' + encodeURIComponent('密码错误'));
  }
});

router.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_session=; Path=/admin; HttpOnly; Max-Age=0');
  res.redirect('/admin/login');
});

// 需要认证的路由
router.use(requireAuth);

// ============ 仪表盘 ============
router.get('/', (req, res) => {
  const stats = db.getStats();
  const agentLogs = db.getAgentLogs(30);
  const agentStatuses = db.getAgentStatuses();
  const schedules = db.getSchedules();
  res.render('admin/dashboard', { title: '控制面板', stats, agentLogs, agentStatuses, schedules, getConfig, success: req.query.success, error: req.query.error });
});

// ============ 系统设置 ============
router.get('/settings', (req, res) => {
  const config = getConfig();
  res.render('admin/settings', { title: '系统设置', config, success: req.query.success, error: req.query.error });
});

router.post('/settings', (req, res) => {
  try {
    const fields = ['site_title', 'site_description', 'site_theme', 'site_direction', 'site_language', 'site_url', 'tavily_api_key'];
    for (const field of fields) { if (req.body[field] !== undefined) db.setSetting(field, req.body[field]); }
    refreshConfig();
    res.redirect('/admin/settings?success=1');
  } catch (err) { res.redirect('/admin/settings?error=' + encodeURIComponent(err.message)); }
});

// 修改密码
router.post('/change-password', (req, res) => {
  const { old_password, new_password } = req.body;
  const admin = db.getAdmin();
  const oldHash = crypto.createHash('sha256').update(old_password || '').digest('hex');
  if (oldHash !== admin.password) return res.redirect('/admin/settings?error=' + encodeURIComponent('原密码错误'));
  if (!new_password || new_password.length < 4) return res.redirect('/admin/settings?error=' + encodeURIComponent('新密码至少4位'));
  db.setAdminPassword(crypto.createHash('sha256').update(new_password).digest('hex'));
  res.redirect('/admin/settings?success=' + encodeURIComponent('密码已修改'));
});

// 切换自动循环
router.post('/toggle-loop', (req, res) => {
  const config = getConfig();
  const newState = config.ai_loop_enabled === '1' ? '0' : '1';
  db.setSetting('ai_loop_enabled', newState);
  refreshConfig();
  if (newState === '1') { try { const { startScheduler } = require('../scheduler'); startScheduler(); } catch {} }
  res.redirect('/admin?success=' + encodeURIComponent(newState === '1' ? '自动循环已开启' : '自动循环已关闭'));
});

// ============ AI 提供商管理 ============
router.get('/providers', (req, res) => {
  const providers = db.getAIProviders();
  res.render('admin/providers', { title: 'AI 提供商', providers, success: req.query.success, error: req.query.error });
});

router.post('/providers/add', async (req, res) => {
  const { name, base_url, api_key, model } = req.body;
  if (!name || !base_url || !api_key || !model) return res.redirect('/admin/providers?error=' + encodeURIComponent('请填写完整信息'));
  db.addAIProvider({ name, base_url, api_key, model });
  refreshConfig();
  res.redirect('/admin/providers?success=' + encodeURIComponent(`提供商 "${name}" 已添加`));
});

router.post('/providers/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  const provider = db.getAIProviders().find(p => p.id === id);
  if (provider) db.updateAIProvider(id, { enabled: !provider.enabled });
  res.redirect('/admin/providers');
});

router.post('/providers/:id/delete', (req, res) => {
  db.deleteAIProvider(parseInt(req.params.id));
  res.redirect('/admin/providers?success=1');
});

router.post('/providers/:id/test', async (req, res) => {
  const provider = db.getAIProviders().find(p => p.id === parseInt(req.params.id));
  if (!provider) return res.json({ success: false, error: '提供商不存在' });
  const result = await testConnection(provider);
  res.json(result);
});

// ============ 分类 CRUD ============
router.get('/categories', (req, res) => {
  const categories = db.getCategories();
  res.render('admin/categories', { title: '栏目管理', categories, success: req.query.success, error: req.query.error });
});

router.post('/categories/add', (req, res) => {
  const { name, slug, description, sort_order } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/categories?error=' + encodeURIComponent('请输入栏目名称'));
  const finalSlug = slug?.trim() || name.trim().toLowerCase().replace(/[\s]+/g, '-').replace(/[^a-z0-9一-龥-]/g, '');
  if (!finalSlug) return res.redirect('/admin/categories?error=' + encodeURIComponent('URL标识不能为空'));
  // 检查重复
  const existing = db.getCategoryBySlug(finalSlug);
  if (existing) return res.redirect('/admin/categories?error=' + encodeURIComponent('URL标识已存在: ' + finalSlug));
  db.addCategory(name.trim(), finalSlug, description?.trim(), parseInt(sort_order) || 0);
  res.redirect('/admin/categories?success=1');
});

router.post('/categories/:id/edit', (req, res) => {
  const { name, slug, description, sort_order } = req.body;
  db.updateCategory(parseInt(req.params.id), { name, slug, description, sort_order: parseInt(sort_order) || 0 });
  res.redirect('/admin/categories?success=1');
});

router.post('/categories/:id/delete', (req, res) => {
  db.deleteCategory(parseInt(req.params.id));
  res.redirect('/admin/categories?success=1');
});

// ============ 文章 CRUD ============
router.get('/articles', (req, res) => {
  const status = req.query.status || null;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const allPages = db.getAllPages(status);
  const total = allPages.length;
  const totalPages = Math.ceil(total / limit);
  const pages = allPages.slice((page - 1) * limit, page * limit);
  res.render('admin/articles', { title: '文章管理', pages, status, page, totalPages, total, success: req.query.success, error: req.query.error });
});

router.get('/articles/new', (req, res) => {
  const categories = db.getCategories();
  res.render('admin/article-edit', { title: '新建文章', article: null, categories, success: req.query.success, error: req.query.error });
});

router.get('/articles/:id/edit', (req, res) => {
  const article = db.getPageById(parseInt(req.params.id));
  if (!article) return res.redirect('/admin/articles?error=' + encodeURIComponent('文章不存在'));
  const categories = db.getCategories();
  res.render('admin/article-edit', { title: '编辑文章', article, categories, success: req.query.success, error: req.query.error });
});

router.post('/articles/save', (req, res) => {
  const { id, title, slug, category_id, summary, content_md, status, seo_title, seo_description, seo_keywords, featured } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin/articles?error=' + encodeURIComponent('标题不能为空'));
  const finalSlug = slug?.trim() || require('../ai/utils').slugify(title.trim());
  if (!finalSlug) return res.redirect('/admin/articles?error=' + encodeURIComponent('URL标识不能为空'));
  // 检查重复 slug（编辑时排除自身）
  const existing = db.getPageBySlug(finalSlug);
  if (existing && (!id || existing.id !== parseInt(id))) {
    return res.redirect('/admin/articles?error=' + encodeURIComponent('URL标识已存在: ' + finalSlug));
  }
  const { marked } = require('marked');
  const content_html = marked(content_md || '');
  const now = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  const pageData = { title: title.trim(), slug: finalSlug, category_id: category_id ? parseInt(category_id) : null, summary: summary?.trim(), content_md: content_md || '', content_html, status: status || 'draft', seo_title: seo_title?.trim(), seo_description: seo_description?.trim(), seo_keywords: seo_keywords?.trim(), featured: featured === 'on' ? 1 : 0, published_at: status === 'published' ? now() : null };
  if (id) { db.updatePage(parseInt(id), pageData); } else { db.insertPage(pageData); }
  res.redirect('/admin/articles?success=1');
});

router.post('/articles/:id/delete', (req, res) => {
  db.deletePage(parseInt(req.params.id));
  res.redirect('/admin/articles?success=1');
});

router.post('/articles/:id/status', (req, res) => {
  const { status } = req.body;
  const updates = { status };
  if (status === 'published') updates.published_at = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  db.updatePage(parseInt(req.params.id), updates);
  res.redirect('/admin/articles?success=1');
});

// AI 润色文章
router.post('/articles/:id/polish', async (req, res) => {
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
    db.updatePage(article.id, { title: data.title || article.title, summary: data.summary || article.summary, content_md: data.content_md || article.content_md, content_html: marked(data.content_md || article.content_md), seo_title: data.seo_title || article.seo_title, seo_description: data.seo_description || article.seo_description });
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
  res.render('admin/schedules', { title: '定时任务', schedules, success: req.query.success, error: req.query.error });
});

router.post('/schedules/:id/toggle', (req, res) => {
  const schedule = db.getSchedules().find(s => s.id === parseInt(req.params.id));
  if (schedule) db.updateSchedule(schedule.id, { enabled: schedule.enabled ? 0 : 1 });
  res.redirect('/admin/schedules');
});

router.post('/schedules/add', (req, res) => {
  const { task_type, cron_expr, description } = req.body;
  if (!task_type || !cron_expr) return res.redirect('/admin/schedules?error=' + encodeURIComponent('请填写完整'));
  db.addSchedule(task_type, cron_expr, description || task_type);
  res.redirect('/admin/schedules?success=1');
});

router.post('/schedules/:id/delete', (req, res) => {
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
  res.render('admin/logs', { title: 'Agent 日志', logs, agentStatuses, page, totalPages, total });
});

// ============ 手动触发 ============
router.post('/trigger/:taskType', async (req, res) => {
  const { taskType } = req.params;
  try {
    if (db.getAIProviders().filter(p => p.enabled).length === 0) return res.redirect('/admin?error=' + encodeURIComponent('请先添加 AI 提供商'));
    const { executeTask } = require('../scheduler');
    executeTask(taskType).catch(err => console.error(`任务 ${taskType} 失败:`, err));
    res.redirect('/admin?success=' + encodeURIComponent(`任务 ${taskType} 已触发`));
  } catch (err) { res.redirect('/admin?error=' + encodeURIComponent(err.message)); }
});

// ============ 冷启动 / 清除 ============
router.post('/cold-start', async (req, res) => {
  if (db.getAIProviders().filter(p => p.enabled).length === 0) return res.redirect('/admin?error=' + encodeURIComponent('请先添加 AI 提供商'));
  try { const { coldStart } = require('../scheduler'); coldStart().catch(err => console.error('冷启动失败:', err)); res.redirect('/admin?success=' + encodeURIComponent('冷启动已触发，正在生成初始内容...')); } catch (err) { res.redirect('/admin?error=' + encodeURIComponent(err.message)); }
});

router.post('/clear-content', async (req, res) => {
  try {
    db.clearAllContent();
    refreshConfig();
    const { coldStart } = require('../scheduler');
    coldStart().catch(err => console.error('重新生成失败:', err));
    res.redirect('/admin?success=' + encodeURIComponent('已清除旧内容，正在重新生成...'));
  } catch (err) { res.redirect('/admin?error=' + encodeURIComponent(err.message)); }
});

module.exports = router;
