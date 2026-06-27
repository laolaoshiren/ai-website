const { callAIForJSON: defaultCallAIForJSON } = require('./client');
const {
  REQUIRED_TEMPLATES,
  REQUIRED_PARTIALS,
  REQUIRED_ASSETS,
  ALLOWED_SITE_TYPES,
  validateThemePackage,
} = require('./theme-sdk');

function siteTypeLabel(siteType) {
  return {
    news: '新闻资讯站',
    blog: '个人/团队博客',
    cms: '综合内容 CMS',
    magazine: '专题杂志',
    knowledge_base: '知识库',
  }[siteType] || '内容站';
}

function defaultTemplate(pageName) {
  const titleExpr = pageName === 'article'
    ? '<%= article.title %>'
    : pageName === 'category'
      ? '<%= category.name %>'
      : '<%= siteTitle %>';
  return `<!DOCTYPE html>
<html lang="<%= siteLanguage || 'zh-CN' %>">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titleExpr} | <%= siteTitle %></title>
  <meta name="description" content="<%= metaDescription || siteDescription || '' %>">
  <link rel="stylesheet" href="<%= themeAssetUrl %>">
</head>
<body>
  <header class="site-header"><a href="/"><%= siteTitle %></a></header>
  <main class="theme-page theme-${pageName}">
    <section class="hero">
      <p class="eyebrow"><%= siteDescription || 'AI generated site' %></p>
      <h1>${titleExpr}</h1>
    </section>
    <section class="content-grid">
      <% (articles || latest || relatedArticles || []).slice(0, 12).forEach(function(item) { %>
        <article class="card"><a href="/article/<%= item.slug %>"><%= item.title %></a><p><%= item.summary || '' %></p></article>
      <% }) %>
      <% if (article && pageName === 'article') { %><article class="article-body"><%- article.content_html || article.content_md || '' %></article><% } %>
    </section>
  </main>
  <footer class="site-footer"><%= siteTitle %></footer>
</body>
</html>`;
}

function defaultPartial(name) {
  if (name === 'article-card') return '<article class="card"><a href="/article/<%= article.slug %>"><%= article.title %></a></article>';
  if (name === 'pagination') return '<nav class="pagination"></nav>';
  if (name === 'header') return '<header class="site-header"><a href="/"><%= siteTitle %></a></header>';
  return '<footer class="site-footer"><%= siteTitle %></footer>';
}

function defaultCss(site = {}) {
  const type = site.site_type || 'cms';
  const palette = {
    news: ['#0f172a', '#2563eb', '#f8fafc'],
    blog: ['#1f2937', '#16a34a', '#fbf7ef'],
    cms: ['#111827', '#7c3aed', '#f9fafb'],
    magazine: ['#18181b', '#e11d48', '#fff7ed'],
    knowledge_base: ['#0f172a', '#0891b2', '#f0fdfa'],
  }[type] || ['#111827', '#2563eb', '#ffffff'];
  return `:root{--ink:${palette[0]};--brand:${palette[1]};--paper:${palette[2]};--muted:#64748b}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;line-height:1.7}
a{color:inherit;text-decoration:none}.site-header,.site-footer{max-width:1180px;margin:0 auto;padding:22px 24px;font-weight:800}
.theme-page{max-width:1180px;margin:0 auto;padding:24px}.hero{padding:56px 0 34px;border-bottom:1px solid rgba(15,23,42,.1)}
.eyebrow{color:var(--brand);font-weight:800}.hero h1{font-size:clamp(2rem,4vw,4.5rem);line-height:1.08;margin:.2em 0}
.content-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:28px}.card{background:#fff;border:1px solid rgba(15,23,42,.1);border-radius:8px;padding:18px;box-shadow:0 14px 32px rgba(15,23,42,.07)}
.card a{font-weight:800}.card p{color:var(--muted)}.article-body{grid-column:1/-1;max-width:760px;font-size:1.06rem}.article-body img{max-width:100%;height:auto}
@media(max-width:720px){.theme-page{padding:16px}.hero{padding:34px 0 22px}.content-grid{grid-template-columns:1fr}.site-header,.site-footer{padding:18px 16px}}`;
}

function normalizeTemplateContent(content) {
  return String(content ?? '').replace(/href=(["'])\/assets\/theme\.css\1/g, 'href="<%= themeAssetUrl %>"');
}

function normalizePackage(raw = {}, site = {}) {
  const siteType = ALLOWED_SITE_TYPES.includes(site.site_type) ? site.site_type : 'cms';
  const manifest = {
    name: raw.manifest?.name || `${site.title || 'AI'} ${siteTypeLabel(siteType)}主题`,
    version: raw.manifest?.version || '1.0.0',
    site_type: raw.manifest?.site_type || siteType,
    design_note: raw.design_note || raw.manifest?.design_note || '',
    templates: REQUIRED_TEMPLATES,
    partials: REQUIRED_PARTIALS,
    assets: REQUIRED_ASSETS,
  };
  const files = { ...(raw.files || {}) };
  for (const pageName of REQUIRED_TEMPLATES) {
    const filePath = `templates/${pageName}.ejs`;
    if (!files[filePath]) files[filePath] = defaultTemplate(pageName);
    else files[filePath] = normalizeTemplateContent(files[filePath]);
  }
  for (const partial of REQUIRED_PARTIALS) {
    const filePath = `partials/${partial}.ejs`;
    if (!files[filePath]) files[filePath] = defaultPartial(partial);
  }
  if (!files['assets/theme.css']) files['assets/theme.css'] = defaultCss({ ...site, site_type: siteType });
  return { manifest, files, design_note: manifest.design_note };
}

function buildThemePrompt({ site = {}, articles = [], categories = [], instruction = '' } = {}) {
  return [
    {
      role: 'system',
      content: `你是资深 CMS 主题设计师。你只能按 Theme SDK 输出 JSON，不能修改系统文件。必须生成完整主题包，包含 templates、partials、assets/theme.css。不要输出 Markdown。

差异化要求（非常重要）：
- 必须做出和内置主题明显不同的视觉语言、信息架构和页面节奏，distinct by default。
- 不要复刻“顶部导航 + 居中 hero + 三列文章卡片”的常规模板站结构。
- 也不要把它改名成“顶部横向导航 + 深色科技背景 + 文章卡片网格 + 侧边栏排行”；这仍然会被判定为内置主题近亲。
- 主题必须像第三方作者从空白 SDK 独立创作的完整皮肤：版式家族、导航模式、首页信息组织、移动端组织方式都应明显不同。
- 优先选择非内置布局家族，例如：封面目录、文档工作台、报纸版面、时间线、地图/索引、专题橱窗、任务看板、分栏长卷。
- 移动端不能把栏目导航挤成竖排文字；必须使用折叠菜单、可横向滚动标签、换行芯片或底部/抽屉导航。
- 不得复用内置主题的主要 class 命名和结构套路：site-header、hero-section、articles-grid、article-card、site-title、site-description、container。
- 根据网站类型选择强风格方向：新闻可做编辑部/快讯流，博客可做作者手札/专栏，CMS 可做信息门户，杂志可做封面目录，知识库可做文档索引。
- 首页必须有一个第一眼能看出主题差异的布局，而不是只换颜色。
- 保持可读性和移动端稳定，不要为了差异化牺牲文章阅读。`,
    },
    {
      role: 'user',
      content: `网站信息：
标题：${site.title || ''}
描述：${site.description || ''}
主题：${site.theme || ''}
方向：${site.direction || ''}
网站类型：${site.site_type || 'cms'}（${siteTypeLabel(site.site_type)}）
栏目数量：${categories.length}
文章数量：${articles.length}
管理员要求：${instruction || '无'}

请返回 JSON：
{
  "manifest": {"name":"","version":"1.0.0","site_type":"${site.site_type || 'cms'}","design_note":"","templates":["home","article","category","archive","search","404"],"partials":["header","footer","article-card","pagination"],"assets":["assets/theme.css"]},
  "files": {"templates/home.ejs":"完整EJS", "assets/theme.css":"完整CSS"},
  "design_note": "设计说明"
}`,
    },
  ];
}

async function generateThemePackage(options = {}) {
  const callAIForJSON = options.callAIForJSON || defaultCallAIForJSON;
  const messages = buildThemePrompt(options);
  const result = await callAIForJSON(messages, {
    taskType: 'generate_frontend_theme',
    maxTokens: 12000,
    temperature: 0.72,
  });
  const pkg = normalizePackage(result.data || {}, options.site || {});
  const validation = validateThemePackage(pkg);
  if (!validation.ok) throw new Error(`AI theme package invalid: ${validation.errors.join('; ')}`);
  pkg.ai = { provider: result.provider || '', model: result.model || '', tokensUsed: result.tokensUsed || 0 };
  return pkg;
}

module.exports = {
  buildThemePrompt,
  generateThemePackage,
  normalizePackage,
  defaultCss,
};
