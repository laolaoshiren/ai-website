/**
 * AI 智能网站 v2 - 多 Agent 协同系统
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 全局模板变量
app.use((req, res, next) => {
  const { getConfig } = require('./config');
  const config = getConfig();
  res.locals.siteTitle = config.site_title || 'AI 智能网站';
  res.locals.siteDescription = config.site_description || '';
  res.locals.siteLanguage = config.site_language || 'zh-CN';
  res.locals.currentPath = req.path;
  res.locals.categories = [];
  try { const { getCategories } = require('./db/database'); res.locals.categories = getCategories(); } catch {}
  next();
});

const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const apiRoutes = require('./routes/api');
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/', publicRoutes);

app.use((req, res) => { res.status(404).render('pages/404', { title: '页面未找到' }); });
app.use((err, req, res, next) => { console.error('服务器错误:', err); res.status(500).send('服务器内部错误'); });

['data', 'logs', 'public/images'].forEach(dir => { const p = path.join(__dirname, dir); if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });

(async () => {
  await initDb();

  // 一键初始化（密码、迁移、提供商检查）
  const { bootstrap } = require('./db/bootstrap');
  await bootstrap();

  const { isAIConfigured, getConfig } = require('./config');
  const config = getConfig();

  const startServer = (port) => {
    const server = app.listen(port, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════╗');
      console.log('║     🤖 AI 智能网站 v2 已启动！           ║');
      console.log('╠══════════════════════════════════════════╣');
      console.log(`║  🌐 网站: http://localhost:${port}            ║`);
      console.log(`║  ⚙️  后台: http://localhost:${port}/admin      ║`);
      console.log('╚══════════════════════════════════════════╝');
      console.log('');

      const admin = require('./db/database').getAdmin();
      if (!admin.setup) {
        console.log('🔑 首次使用！请访问 /admin/setup 设置管理员密码');
      } else if (isAIConfigured() && config.ai_loop_enabled === '1') {
        try { const { startScheduler } = require('./scheduler'); startScheduler(); console.log('⏰ 定时任务调度器已启动'); } catch (err) { console.error('调度器启动失败:', err.message); }
      } else {
        console.log('⏸  请访问 /admin 配置 AI 提供商后启用自动循环');
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  端口 ${port} 被占用，尝试 ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('服务器启动失败:', err);
        process.exit(1);
      }
    });
  };

  startServer(parseInt(PORT));
})();
