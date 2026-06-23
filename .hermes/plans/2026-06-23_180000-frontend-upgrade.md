# 前端全面升级实施计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 将 AI 智能网站前端升级为 2026 年水准的现代精致型网站，全面对标 Linear/Vercel/Stripe 级别的设计品质。

**Architecture:** 纯 CSS + 原生 JS，无构建工具依赖。CSS 变量系统化管理设计 token（颜色、间距、圆角、阴影、动画），支持暗色主题一键切换。

**Tech Stack:** CSS Custom Properties, CSS Animations, IntersectionObserver, requestAnimationFrame, Web Animations API

**设计语言：** 玻璃拟态(Glassmorphism) + 微交互(Micro-interactions) + 流体动画(Fluid Animation) + 精致排版(Typography-first)

---

## 设计规范 Token

在 style.css 顶部定义完整的设计系统：

```css
:root {
  /* 色彩系统 - 亮色 */
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-light: #eff6ff;
  --primary-glow: rgba(37, 99, 235, 0.15);
  --accent: #7c3aed;
  --accent-light: #f5f3ff;
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;

  /* 中性色 */
  --bg: #f8fafc;
  --bg-elevated: #ffffff;
  --bg-sunken: #f1f5f9;
  --surface: #ffffff;
  --surface-hover: #f8fafc;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-tertiary: #94a3b8;
  --border: #e2e8f0;
  --border-subtle: #f1f5f9;
  --divider: #e2e8f0;

  /* 阴影系统 - 4 级 */
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04);
  --shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.04);
  --shadow-glow: 0 0 20px var(--primary-glow);

  /* 圆角系统 */
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* 间距系统 - 4px 基准 */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* 排版 */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'Noto Sans SC', 'PingFang SC', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 2rem;
  --leading-tight: 1.25;
  --leading-normal: 1.6;
  --leading-relaxed: 1.8;
  --tracking-tight: -0.025em;
  --tracking-normal: 0;

  /* 动画 */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;

  /* 布局 */
  --max-width: 1200px;
  --content-width: 720px;
  --header-height: 64px;
}

[data-theme="dark"] {
  --primary: #60a5fa;
  --primary-hover: #93c5fd;
  --primary-light: #1e293b;
  --primary-glow: rgba(96, 165, 250, 0.15);
  --accent: #a78bfa;
  --accent-light: #1e1b3a;
  --bg: #0a0a0f;
  --bg-elevated: #141420;
  --bg-sunken: #0a0a0f;
  --surface: #1a1a2e;
  --surface-hover: #22223a;
  --text-primary: #e8e8ed;
  --text-secondary: #a0a0b0;
  --text-tertiary: #606070;
  --border: #2a2a3e;
  --border-subtle: #1e1e30;
  --divider: #2a2a3e;
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.2);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.3);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.3);
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.4);
}
```

---

## 当前状态分析

| 模块 | 现状 | 问题 |
|------|------|------|
| 搜索 | 无 | 用户无法搜索文章 |
| 文章导航 | 无 | 看完一篇不知道下一篇去哪 |
| 404 页面 | 只显示"未找到" | 无引导，用户直接流失 |
| 归档 | 无 | 文章多了无法按时间浏览 |
| 回到顶部 | 无 | 长文章滚动后无法快速回顶 |
| 主题 | 只有亮色 | 无暗色模式 |
| 文章页 | 基础排版 | 无目录、无进度条、无相关推荐 |
| 代码块 | 有样式 | 无复制按钮、无语言标签 |
| 动效 | 无 | 页面生硬，无过渡 |
| 分享 | 无 | 无社交分享 |
| 移动端 | 基础响应式 | 汉堡菜单体验粗糙 |
| Hero 区 | 纯色渐变 | 缺少视觉层次和动效 |
| 文章卡片 | 纯白底 | 缺少悬停微交互和视觉深度 |
| 排版 | 默认行高 | 缺少精致的字间距、段落节奏 |
| 微交互 | 无 | 按钮/链接缺少悬停/点击反馈 |
| 配色 | 单一蓝紫 | 缺少辅助色和渐变层次 |

---

## 视觉升级专项（贯穿所有 Task）

### Hero 区域升级
- 背景：多层渐变 + CSS 动画粒子/网格纹理
- 标题：`background-clip: text` 渐变文字 + `animation: shimmer` 微光效果
- 徽章：玻璃拟态 `backdrop-filter: blur(10px)` + 微边框

### 文章卡片升级
- 悬停：`transform: translateY(-4px)` + `box-shadow` 深度变化 + 边框高光
- 分类标签：渐变背景而非纯色
- AI 标记：微光脉冲动画
- 标题悬停：颜色渐变过渡

### 按钮系统升级
- 主按钮：渐变背景 + 悬停发光 + 点击缩放 `scale(0.98)`
- 次按钮：玻璃拟态背景 + 悬停填色
- 图标按钮：SVG 图标 + 悬停旋转/弹跳

### 滚动动效
- 卡片入场：`opacity + translateY` 渐入上移，stagger 间隔
- 标题入场：`clip-path` 从左到右展开
- 数字计数：统计数字滚动递增动画

### 骨架屏加载
- 文章加载时显示骨架屏占位符
- 图片：渐进式加载（模糊 → 清晰）

---

## Task 1: CSS 变量重构 + 暗色主题 + 视觉基底

**Objective:** 建立设计系统基础，实现一键暗色主题切换，所有组件升级为现代视觉语言。

**Files:**
- Modify: `public/css/style.css`（完全重写）
- Modify: `views/partials/header.ejs`
- Create: `public/js/theme.js`

**视觉升级要点：**
- **卡片**：`backdrop-filter: blur()` 毛玻璃效果（暗色主题下）
- **Header**：`backdrop-filter: blur(12px)` + 半透明背景，滚动时加深
- **按钮悬停**：`transform: translateY(-1px)` + `box-shadow` 升起效果
- **链接**：下划线用 `background-image: linear-gradient()` 渐变下划线
- **输入框聚焦**：`box-shadow: 0 0 0 3px var(--primary-glow)` 发光边框
- **整体背景**：暗色主题用微噪点纹理 `background-image: url("data:image/svg+xml...")` 增加质感

**Step 1: 重构 CSS 变量**

将 `:root` 改为双主题变量：

```css
:root {
  --primary: #2563eb;
  --primary-dark: #1d4ed8;
  --primary-light: #dbeafe;
  --accent: #7c3aed;
  --bg: #f8fafc;
  --bg-white: #ffffff;
  --bg-card: #ffffff;
  --text: #1e293b;
  --text-light: #64748b;
  --border: #e2e8f0;
  --code-bg: #1e293b;
  --shadow: 0 1px 3px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 25px rgba(0,0,0,0.1);
  --radius: 12px;
  --radius-sm: 8px;
  --max-width: 1200px;
  --header-height: 64px;
}

[data-theme="dark"] {
  --primary: #60a5fa;
  --primary-dark: #93bbfd;
  --primary-light: #1e3a5f;
  --accent: #a78bfa;
  --bg: #0f172a;
  --bg-white: #1e293b;
  --bg-card: #1e293b;
  --text: #e2e8f0;
  --text-light: #94a3b8;
  --border: #334155;
  --code-bg: #0f172a;
  --shadow: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-lg: 0 10px 25px rgba(0,0,0,0.3);
}
```

**Step 2: 全局替换硬编码颜色**

将所有 `background: #fff`、`background: #f8fafc`、`color: #1e293b` 等硬编码颜色替换为对应 CSS 变量。

**Step 3: 添加主题切换按钮**

在 `views/partials/header.ejs` 的导航末尾添加：

```html
<button class="theme-toggle" onclick="toggleTheme()" aria-label="切换主题">
  <span class="theme-icon">🌙</span>
</button>
```

**Step 4: 添加主题切换 JS**

在 `public/js/` 下创建主题切换逻辑，使用 localStorage 持久化：

```javascript
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  document.querySelector('.theme-icon').textContent = next === 'dark' ? '☀️' : '🌙';
}

// 初始化
(function() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();
```

**Step 5: CSS for toggle button**

```css
.theme-toggle {
  background: none; border: none; cursor: pointer;
  padding: 0.4rem; font-size: 1.2rem; border-radius: 50%;
  transition: background 0.2s;
}
.theme-toggle:hover { background: var(--primary-light); }
```

**验证:** 刷新页面，点击切换按钮，所有颜色跟随切换。刷新后保持选择。

**Commit:** `feat: dark theme with CSS variables and toggle button`

---

## Task 2: 阅读进度条

**Objective:** 文章页顶部显示阅读进度条。

**Files:**
- Modify: `views/pages/article.ejs`
- Modify: `public/css/style.css`

**Step 1: 添加进度条 HTML**

在 `article.ejs` 的 `<body>` 标签后、header 之前添加：

```html
<div class="reading-progress" id="reading-progress"></div>
```

**Step 2: CSS**

```css
.reading-progress {
  position: fixed; top: 0; left: 0; height: 3px; z-index: 999;
  background: linear-gradient(90deg, var(--primary), var(--accent));
  width: 0%; transition: width 0.1s;
}
```

**Step 3: JS（在文章页底部）**

```javascript
window.addEventListener('scroll', function() {
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const progress = (window.scrollY / docHeight) * 100;
  document.getElementById('reading-progress').style.width = Math.min(progress, 100) + '%';
});
```

**验证:** 滚动文章页，顶部出现蓝紫渐变进度条。

**Commit:** `feat: reading progress bar on article pages`

---

## Task 3: 文章目录（TOC）自动生成

**Objective:** 文章页右侧自动生成 H2/H3 目录，点击跳转。

**Files:**
- Modify: `views/pages/article.ejs`
- Modify: `public/css/style.css`

**Step 1: 添加 TOC 容器**

在 `article-content` div 之后添加：

```html
<aside class="toc-sidebar" id="toc-sidebar">
  <div class="toc-title">📑 目录</div>
  <nav class="toc-list" id="toc-list"></nav>
</aside>
```

**Step 2: CSS**

```css
.article-detail { position: relative; }
.toc-sidebar {
  position: fixed; right: 2rem; top: calc(var(--header-height) + 2rem);
  width: 220px; max-height: calc(100vh - var(--header-height) - 4rem);
  overflow-y: auto; font-size: 0.82rem; display: none;
}
@media (min-width: 1200px) { .toc-sidebar { display: block; } }
.toc-title { font-weight: 700; margin-bottom: 0.75rem; color: var(--text); }
.toc-list a {
  display: block; padding: 0.3rem 0; color: var(--text-light);
  border-left: 2px solid transparent; padding-left: 0.75rem;
  transition: all 0.2s;
}
.toc-list a:hover, .toc-list a.active {
  color: var(--primary); border-left-color: var(--primary);
}
.toc-list a.toc-h3 { padding-left: 1.5rem; font-size: 0.78rem; }
```

**Step 3: JS**

```javascript
(function() {
  const content = document.querySelector('.article-content');
  const list = document.getElementById('toc-list');
  if (!content || !list) return;
  const headings = content.querySelectorAll('h2, h3');
  if (headings.length < 2) { document.getElementById('toc-sidebar')?.remove(); return; }
  headings.forEach(function(h, i) {
    if (!h.id) h.id = 'heading-' + i;
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    if (h.tagName === 'H3') a.className = 'toc-h3';
    list.appendChild(a);
  });
  // Scroll spy
  var links = list.querySelectorAll('a');
  window.addEventListener('scroll', function() {
    var current = '';
    headings.forEach(function(h) {
      if (window.scrollY >= h.offsetTop - 100) current = h.id;
    });
    links.forEach(function(a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  });
})();
```

**验证:** 宽屏（≥1200px）文章页右侧出现目录，点击跳转，滚动高亮。

**Commit:** `feat: auto-generated table of contents for articles`

---

## Task 4: 代码块复制按钮 + 语言标签

**Objective:** 代码块右上角显示语言标签和复制按钮。

**Files:**
- Modify: `views/pages/article.ejs`（添加 JS）
- Modify: `public/css/style.css`

**Step 1: CSS**

```css
.article-content pre { position: relative; }
.code-header {
  display: flex; justify-content: space-between; align-items: center;
  background: #0f172a; padding: 0.5rem 1rem; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  font-size: 0.78rem; color: #94a3b8;
}
.code-header + pre { border-radius: 0 0 var(--radius-sm) var(--radius-sm); margin-top: 0; }
.copy-btn {
  background: rgba(255,255,255,0.1); border: none; color: #94a3b8;
  padding: 0.2rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 0.75rem;
}
.copy-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
```

**Step 2: JS（在文章页）**

```javascript
document.querySelectorAll('.article-content pre').forEach(function(pre) {
  var code = pre.querySelector('code');
  var lang = '';
  if (code) {
    var cls = code.className.match(/language-(\w+)/);
    if (cls) lang = cls[1];
  }
  var header = document.createElement('div');
  header.className = 'code-header';
  header.innerHTML = '<span>' + lang + '</span><button class="copy-btn">复制</button>';
  header.querySelector('.copy-btn').onclick = function() {
    navigator.clipboard.writeText(code?.textContent || pre.textContent);
    this.textContent = '✓ 已复制';
    setTimeout(function() { header.querySelector('.copy-btn').textContent = '复制'; }, 2000);
  };
  pre.parentNode.insertBefore(header, pre);
});
```

**验证:** 代码块顶部显示语言名 + 复制按钮，点击复制成功。

**Commit:** `feat: code block copy button and language label`

---

## Task 5: 相关文章推荐

**Objective:** 文章底部自动推荐 3 篇同栏目文章。

**Files:**
- Modify: `routes/public.js`（传入 relatedArticles）
- Modify: `views/pages/article.ejs`（渲染推荐区）

**Step 1: 修改路由**

在 `routes/public.js` 的文章详情路由中，获取同栏目文章：

```javascript
const allInCategory = article.category_id
  ? getPublishedPages(10, 0, article.category_id).filter(p => p.id !== article.id)
  : [];
const relatedArticles = allInCategory.slice(0, 3);
```

传入模板：`relatedArticles`

**Step 2: 模板**

在 `article-footer` 之后添加：

```html
<% if (typeof relatedArticles !== 'undefined' && relatedArticles.length > 0) { %>
<section class="related-section">
  <div class="container">
    <h2 class="section-title">📖 相关推荐</h2>
    <div class="articles-grid">
      <% relatedArticles.forEach(function(a) { %>
        <%- include('../partials/article-card', { article: a }) %>
      <% }); %>
    </div>
  </div>
</section>
<% } %>
```

**Step 3: CSS**

```css
.related-section { padding: 2rem 0 3rem; border-top: 1px solid var(--border); }
```

**验证:** 文章底部出现同栏目推荐卡片。

**Commit:** `feat: related articles recommendation`

---

## Task 6: 滚动入场动画

**Objective:** 文章卡片和栏目卡片滚动进入视口时有淡入上移动效。

**Files:**
- Modify: `public/css/style.css`
- Modify: `views/pages/home.ejs`（添加 observer JS）

**Step 1: CSS**

```css
.fade-in {
  opacity: 0; transform: translateY(20px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.fade-in.visible {
  opacity: 1; transform: translateY(0);
}
```

**Step 2: 给卡片加 class**

在 `article-card.ejs` 的 `<article>` 标签加 `class="article-card fade-in"`。
在 `home.ejs` 的 `category-card` 加 `class="category-card fade-in"`。

**Step 3: JS（在 home.ejs 和 category.ejs 底部）**

```javascript
(function() {
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(function(el) { observer.observe(el); });
})();
```

**验证:** 滚动页面，卡片淡入上移出现。

**Commit:** `feat: scroll-triggered fade-in animations`

---

## Task 7: 社交分享按钮

**Objective:** 文章页底部添加微信/微博/Twitter 分享按钮。

**Files:**
- Modify: `views/pages/article.ejs`
- Modify: `public/css/style.css`

**Step 1: HTML（在 article-notice 之后）**

```html
<div class="share-bar">
  <span>分享到：</span>
  <a class="share-btn share-twitter" href="#" onclick="shareTwitter()" target="_blank">𝕏 Twitter</a>
  <a class="share-btn share-weibo" href="#" onclick="shareWeibo()" target="_blank">微博</a>
  <button class="share-btn share-copy" onclick="shareCopy()">📋 复制链接</button>
</div>
```

**Step 2: CSS**

```css
.share-bar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-top: 1.5rem; font-size: 0.9rem; }
.share-btn { padding: 0.4rem 0.8rem; border-radius: 6px; font-size: 0.82rem; border: 1px solid var(--border); background: var(--bg-white); color: var(--text); cursor: pointer; }
.share-btn:hover { border-color: var(--primary); color: var(--primary); }
```

**Step 3: JS**

```javascript
function shareTwitter() {
  var url = encodeURIComponent(window.location.href);
  var text = encodeURIComponent(document.title);
  window.open('https://twitter.com/intent/tweet?url=' + url + '&text=' + text);
}
function shareWeibo() {
  var url = encodeURIComponent(window.location.href);
  var text = encodeURIComponent(document.title);
  window.open('https://service.weibo.com/share/share.php?url=' + url + '&title=' + text);
}
function shareCopy() {
  navigator.clipboard.writeText(window.location.href).then(function() {
    document.querySelector('.share-copy').textContent = '✓ 已复制';
  });
}
```

**验证:** 点击分享按钮正确跳转/复制。

**Commit:** `feat: social share buttons on article pages`

---

## Task 8: 移动端导航优化

**Objective:** 移动端汉堡菜单改为侧滑抽屉 + 遮罩层。

**Files:**
- Modify: `views/partials/header.ejs`
- Modify: `public/css/style.css`

**Step 1: 重写 header.ejs**

```html
<header class="site-header">
  <div class="container">
    <div class="header-inner">
      <a href="/" class="site-logo">
        <span class="logo-icon">🤖</span>
        <span class="logo-text"><%= siteTitle %></span>
      </a>
      <nav class="main-nav" id="main-nav">
        <a href="/" class="nav-link<%= currentPath === '/' ? ' active' : '' %>">首页</a>
        <% if (typeof categories !== 'undefined') { categories.forEach(function(cat) { %>
          <a href="/category/<%= cat.slug %>" class="nav-link<%= currentPath === '/category/' + cat.slug ? ' active' : '' %>"><%= cat.name %></a>
        <% }); } %>
      </nav>
      <div class="header-right">
        <button class="theme-toggle" onclick="toggleTheme()" aria-label="切换主题">
          <span class="theme-icon">🌙</span>
        </button>
        <button class="nav-toggle" onclick="toggleNav()" aria-label="菜单">☰</button>
      </div>
    </div>
  </div>
  <div class="nav-overlay" id="nav-overlay" onclick="toggleNav()"></div>
</header>
```

**Step 2: CSS**

```css
.header-right { display: flex; align-items: center; gap: 0.5rem; }
.nav-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 99; }
.nav-overlay.active { display: block; }

@media (max-width: 768px) {
  .main-nav {
    display: none; position: fixed; top: 0; right: 0; bottom: 0;
    width: 280px; background: var(--bg-white); flex-direction: column;
    padding: 4rem 1.5rem 1.5rem; z-index: 100;
    box-shadow: -4px 0 20px rgba(0,0,0,0.15);
    transform: translateX(100%); transition: transform 0.3s ease;
  }
  .main-nav.open { display: flex; transform: translateX(0); }
  .nav-link { padding: 0.75rem 0; font-size: 1rem; border-bottom: 1px solid var(--border); }
}
```

**Step 3: JS**

```javascript
function toggleNav() {
  document.getElementById('main-nav').classList.toggle('open');
  document.getElementById('nav-overlay').classList.toggle('active');
  document.body.style.overflow = document.getElementById('nav-overlay').classList.contains('active') ? 'hidden' : '';
}
```

**验证:** 移动端点击汉堡按钮，侧滑菜单弹出，点遮罩关闭。

**Commit:** `feat: mobile slide-out navigation drawer`

---

## Task 9: 文章页增强 — 字数统计 + 阅读时间

**Objective:** 文章 meta 区显示字数和预计阅读时间。

**Files:**
- Modify: `views/pages/article.ejs`
- Modify: `routes/public.js`

**Step 1: 路由中计算字数**

```javascript
const contentText = (article.content_md || '').replace(/<[^>]+>/g, '');
const wordCount = contentText.length;
const readTime = Math.max(1, Math.ceil(wordCount / 500));
```

传入模板：`wordCount`, `readTime`

**Step 2: 模板**

在 article-meta 中添加：

```html
<span>📝 约 <%= wordCount %> 字</span>
<span>⏱ <%= readTime %> 分钟阅读</span>
```

**验证:** 文章页显示字数和阅读时间。

**Commit:** `feat: word count and reading time estimate`

---

## Task 10: 打印样式

**Objective:** 打印文章时隐藏导航、侧边栏、按钮，优化排版。

**Files:**
- Modify: `public/css/style.css`

**Step 1: 添加打印样式**

```css
@media print {
  .site-header, .site-footer, .reading-progress, .toc-sidebar,
  .share-bar, .related-section, .breadcrumb, .nav-toggle,
  .theme-toggle, .article-notice { display: none !important; }
  .article-header { background: none !important; color: #000 !important; padding: 1rem 0; }
  .article-content { max-width: 100%; font-size: 12pt; line-height: 1.6; }
  .article-content pre { border: 1px solid #ccc; }
  .article-content a { color: #000; text-decoration: underline; }
  .article-content a::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #666; }
}
```

**验证:** Ctrl+P 打印文章页，排版干净。

**Commit:** `feat: print-optimized styles for articles`

---

## Task 11: 站内搜索功能

**Objective:** header 添加搜索框，支持关键词搜索文章标题和摘要。

**Files:**
- Modify: `views/partials/header.ejs`
- Modify: `routes/public.js`（添加搜索路由）
- Create: `views/pages/search.ejs`
- Modify: `public/css/style.css`

**Step 1: 搜索路由**

在 `routes/public.js` 添加：

```javascript
// 搜索页
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 12;
  let results = [];
  if (q) {
    const all = getPublishedPages(1000);
    const qLower = q.toLowerCase();
    results = all.filter(p =>
      (p.title || '').toLowerCase().includes(qLower) ||
      (p.summary || '').toLowerCase().includes(qLower) ||
      (p.seo_keywords || '').toLowerCase().includes(qLower)
    );
  }
  const total = results.length;
  const totalPages = Math.ceil(total / limit);
  const articles = results.slice((page - 1) * limit, page * limit);
  res.render('pages/search', {
    title: q ? `搜索: ${q}` : '搜索',
    q, articles, page, totalPages, total,
  });
});
```

**Step 2: header 搜索框**

在 header 的 `header-right` 之前添加：

```html
<form class="search-form" action="/search" method="GET">
  <input type="text" name="q" placeholder="搜索文章..." class="search-input" value="">
  <button type="submit" class="search-btn">🔍</button>
</form>
```

**Step 3: CSS**

```css
.search-form { display: flex; align-items: center; margin-right: 0.5rem; }
.search-input {
  padding: 0.4rem 0.8rem; border: 1px solid var(--border);
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  font-size: 0.88rem; background: var(--bg); color: var(--text);
  width: 180px; transition: all 0.2s;
}
.search-input:focus { outline: none; border-color: var(--primary); width: 240px; }
.search-btn {
  padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-left: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--bg-white); cursor: pointer;
}
@media (max-width: 768px) {
  .search-input { width: 120px; }
  .search-input:focus { width: 160px; }
}
```

**Step 4: 搜索结果页 `views/pages/search.ejs`**

复用 category.ejs 的结构，顶部显示搜索框 + 结果数，下方是文章网格 + 分页。

**验证:** header 搜索框输入关键词，回车跳转搜索结果页。

**Commit:** `feat: full-text article search`

---

## Task 12: 上一篇 / 下一篇文章导航

**Objective:** 文章底部显示上一篇和下一篇链接，方便连续阅读。

**Files:**
- Modify: `routes/public.js`
- Modify: `views/pages/article.ejs`
- Modify: `public/css/style.css`

**Step 1: 路由中获取前后文章**

```javascript
const allPublished = getPublishedPages(1000);
const currentIndex = allPublished.findIndex(p => p.id === article.id);
const prevArticle = currentIndex > 0 ? allPublished[currentIndex - 1] : null;
const nextArticle = currentIndex < allPublished.length - 1 ? allPublished[currentIndex + 1] : null;
```

传入模板：`prevArticle`, `nextArticle`

**Step 2: 模板（在 article-footer 之后）**

```html
<nav class="article-nav">
  <% if (typeof prevArticle !== 'undefined' && prevArticle) { %>
    <a href="/article/<%= prevArticle.slug %>" class="nav-prev">
      <span class="nav-label">← 上一篇</span>
      <span class="nav-title"><%= prevArticle.title %></span>
    </a>
  <% } %>
  <% if (typeof nextArticle !== 'undefined' && nextArticle) { %>
    <a href="/article/<%= nextArticle.slug %>" class="nav-next">
      <span class="nav-label">下一篇 →</span>
      <span class="nav-title"><%= nextArticle.title %></span>
    </a>
  <% } %>
</nav>
```

**Step 3: CSS**

```css
.article-nav {
  display: flex; justify-content: space-between; gap: 1rem;
  max-width: 800px; margin: 2rem auto; padding: 1.5rem 0;
  border-top: 1px solid var(--border);
}
.nav-prev, .nav-next {
  flex: 1; padding: 1rem; border-radius: var(--radius-sm);
  background: var(--bg-white); border: 1px solid var(--border);
  transition: all 0.2s; max-width: 48%;
}
.nav-prev:hover, .nav-next:hover { border-color: var(--primary); box-shadow: var(--shadow); }
.nav-label { display: block; font-size: 0.82rem; color: var(--text-light); margin-bottom: 0.3rem; }
.nav-title { font-weight: 600; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.nav-next { text-align: right; }
```

**验证:** 文章底部出现上下篇导航。

**Commit:** `feat: prev/next article navigation`

---

## Task 13: 回到顶部按钮

**Objective:** 滚动超过 300px 后出现回到顶部按钮。

**Files:**
- Modify: `views/partials/footer.ejs`
- Modify: `public/css/style.css`

**Step 1: footer.ejs 末尾添加**

```html
<button class="back-to-top" id="back-to-top" onclick="window.scrollTo({top:0,behavior:'smooth'})" aria-label="回到顶部">↑</button>
```

**Step 2: CSS**

```css
.back-to-top {
  position: fixed; bottom: 2rem; right: 2rem;
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--primary); color: #fff; border: none;
  font-size: 1.2rem; cursor: pointer;
  opacity: 0; transform: translateY(20px);
  transition: all 0.3s; z-index: 50;
  box-shadow: 0 2px 10px rgba(37,99,235,0.3);
}
.back-to-top.visible { opacity: 1; transform: translateY(0); }
.back-to-top:hover { background: var(--primary-dark); transform: translateY(-2px); }
```

**Step 3: JS（全局，在 footer 的 analytics.js 之前）**

```javascript
window.addEventListener('scroll', function() {
  document.getElementById('back-to-top')?.classList.toggle('visible', window.scrollY > 300);
});
```

**验证:** 滚动页面，右下角出现圆形按钮，点击平滑回顶。

**Commit:** `feat: back-to-top button`

---

## Task 14: 文章归档页

**Objective:** 新增 `/archive` 页面，按月份分组展示所有已发布文章。

**Files:**
- Modify: `routes/public.js`
- Create: `views/pages/archive.ejs`
- Modify: `views/partials/footer.ejs`（加链接）

**Step 1: 路由**

```javascript
router.get('/archive', (req, res) => {
  const all = getPublishedPages(1000);
  // 按年月分组
  const groups = {};
  all.forEach(p => {
    const ym = (p.published_at || '').slice(0, 7); // "2026-06"
    if (!ym) return;
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(p);
  });
  const archive = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  res.render('pages/archive', { title: '文章归档', archive });
});
```

**Step 2: 模板**

简洁的时间线布局：左侧年月标签，右侧文章列表。

**Step 3: footer 加归档链接**

```html
<a href="/archive">文章归档</a>
```

**验证:** 访问 `/archive`，按月份展示文章列表。

**Commit:** `feat: article archive page`

---

## Task 15: 404 页面增强 — 推荐热门文章

**Objective:** 404 页面显示最新文章推荐，减少用户流失。

**Files:**
- Modify: `routes/public.js`（404 路由传入 latest）
- Modify: `views/pages/404.ejs`

**Step 1: 修改 404 中间件**

在 `server.js` 的 404 处理中传入最新文章：

```javascript
app.use((req, res) => {
  const latest = getPublishedPages(4);
  res.status(404).render('pages/404', { title: '页面未找到', latest });
});
```

**Step 2: 404 模板增强**

在"返回首页"按钮下方添加：

```html
<% if (typeof latest !== 'undefined' && latest.length > 0) { %>
<div class="error-suggestions">
  <h3>📖 看看这些文章</h3>
  <div class="articles-grid">
    <% latest.forEach(function(article) { %>
      <%- include('../partials/article-card', { article: article }) %>
    <% }); %>
  </div>
</div>
<% } %>
```

**验证:** 访问不存在的 URL，显示 404 + 4 篇推荐文章。

**Commit:** `feat: 404 page with article recommendations`

---

## 文件变更总览

| 文件 | 操作 | 涉及任务 |
|------|------|----------|
| `public/css/style.css` | 重构变量 + 暗色主题 + 所有新组件样式 | 1,2,3,4,6,7,8,11,12,13 |
| `views/partials/header.ejs` | 搜索框 + 主题切换 + 移动端抽屉 | 1,8,11 |
| `views/partials/footer.ejs` | 回到顶部按钮 + 归档链接 | 13,14 |
| `views/partials/article-card.ejs` | fade-in class | 6 |
| `views/pages/article.ejs` | 进度条 + TOC + 代码复制 + 分享 + 字数 + 上下篇 | 2,3,4,5,7,9,12 |
| `views/pages/home.ejs` | 滚动动画 JS | 6 |
| `views/pages/category.ejs` | 滚动动画 JS | 6 |
| `views/pages/404.ejs` | 推荐文章 | 15 |
| `views/pages/search.ejs` | 新建 - 搜索结果页 | 11 |
| `views/pages/archive.ejs` | 新建 - 归档页 | 14 |
| `routes/public.js` | 搜索 + 归档 + 前后篇 + 相关推荐 + 字数 | 5,9,11,12,14 |
| `server.js` | 404 路由传入 latest | 15 |
| `public/js/theme.js` | 新建 - 主题切换逻辑 | 1 |

## 执行顺序

```
Task 1 (暗色主题) ← 必须最先，其他任务的颜色都用 CSS 变量
  ↓
并行批次 A: Task 2, 3, 4, 9, 10, 13 (纯 CSS/JS，互不依赖)
并行批次 B: Task 5, 11, 12, 14, 15 (路由+模板，共享 public.js)
  ↓
Task 6 (滚动动画) ← 需要卡片 class 改动，放最后
Task 7 (分享按钮)
Task 8 (移动端导航)
```

## 风险

- **暗色主题**：admin.css 不需要改（后台独立），但前台 style.css 改动量大，需要仔细测试每个组件
- **TOC 定位**：fixed 定位在小屏会溢出，需要媒体查询隐藏
- **动画性能**：IntersectionObserver 在低端设备上可能卡顿，需要 `will-change` 优化
