/**
 * AI 智能网站 v2 - 多 Agent 协同系统
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// 安全头
try {
  const helmet = require('helmet');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
} catch {}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));
['data', 'data/generated-images', 'data/generated-images/articles', 'logs', 'public/images'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});
app.use('/generated-images', express.static(path.join(__dirname, 'data', 'generated-images')));
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
  res.locals.siteUrl = config.site_url || 'http://localhost:3000';
  res.locals.currentPath = req.path;
  res.locals.categories = [];
  res.locals.friendLinks = [];
  try { const { getCategories, getActiveFriendLinks } = require('./db/database'); res.locals.categories = getCategories(); res.locals.friendLinks = getActiveFriendLinks(); } catch {}
  next();
});

const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const apiRoutes = require('./routes/api');
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/', publicRoutes);

// favicon fallback: generate on-demand if missing
app.get('/favicon.svg', (req, res) => {
  const faviconPath = path.join(__dirname, 'public', 'favicon.svg');
  if (fs.existsSync(faviconPath)) {
    return res.sendFile(faviconPath);
  }
  // Fallback: return a simple default SVG
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#667eea"/><stop offset="100%" style="stop-color:#764ba2"/></linearGradient></defs><rect width="512" height="512" rx="96" fill="url(#bg)"/><text x="256" y="340" font-family="Arial,sans-serif" font-size="300" font-weight="bold" fill="white" text-anchor="middle">AI</text></svg>`);
});

app.use((req, res) => {
  const { getPublishedPages } = require('./db/database');
  const latest = getPublishedPages(4);
  res.status(404).render('pages/404', { title: '页面未找到', latest });
});
app.use((err, req, res, next) => {
  console.error('服务器错误:', err.message);
  // decodeURIComponent 错误（无效编码）→ 404
  if (err instanceof URIError) {
    return res.status(404).render('pages/404', { title: '页面未找到', latest: [] });
  }
  try {
    res.status(500).render('pages/404', { title: '服务器错误', latest: [] });
  } catch { res.status(500).send('服务器内部错误'); }
});

(async () => {
  await initDb();

  // 一键初始化（密码、迁移、提供商检查）
  const { bootstrap } = require('./db/bootstrap');
  await bootstrap();

  const { isAIConfigured, getConfig } = require('./config');
  const config = getConfig();

  // 🖼️ 自动检测并生成站标
  try {
    const { ensureFavicon } = require('./ai/favicon');
    if (isAIConfigured()) {
      await ensureFavicon();
    } else {
      const { hasFavicon, generateFavicon } = require('./ai/favicon');
      if (!hasFavicon()) {
        // 没有 AI 也生成一个 fallback
        generateFavicon(config.site_title || 'AI');
      }
    }
  } catch (err) {
    console.log('⚠️ 站标生成跳过:', err.message);
  }

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
        // 检查是否之前是狂暴模式
        const workMode = config.work_mode || 'smart';
        if (workMode === 'rage') {
          const level = parseInt(config.rage_level) || 3;
          try { const { startRageMode } = require('./scheduler'); startRageMode(level); console.log(`🔥 狂暴模式已恢复（档位 ${level}）`); } catch (err) { console.error('狂暴模式启动失败:', err.message); }
        } else {
          try { const { startScheduler } = require('./scheduler'); startScheduler(); console.log('⏰ 定时任务调度器已启动'); } catch (err) { console.error('调度器启动失败:', err.message); }
        }
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

    // 优雅关闭：SIGTERM / SIGINT
    const gracefulShutdown = (signal) => {
      console.log(`\n🛑 收到 ${signal}，正在优雅关闭...`);
      try { const { stopScheduler } = require('./scheduler'); stopScheduler(); console.log('⏰ 调度器已停止'); } catch {}
      try { const { saveDb } = require('./db/database'); saveDb(); console.log('💾 数据库已保存'); } catch {}
      server.close(() => { console.log('🔌 服务器已关闭'); process.exit(0); });
      setTimeout(() => { console.warn('⚠️  强制退出'); process.exit(1); }, 10000);
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  };

  startServer(parseInt(PORT));
})();
