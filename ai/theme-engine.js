const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  REQUIRED_TEMPLATES,
  validateThemePackage,
  normalizePath,
  assertThemePathSafe,
} = require('./theme-sdk');

const DEFAULT_THEME_ROOT = path.join(__dirname, '..', 'data', 'generated-themes');
const REVIEW_PASS_SCORE = 85;

function timestamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
}

function createThemeId(prefix = 'ai-theme') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function themeRoot(options = {}) {
  return path.resolve(options.rootDir || DEFAULT_THEME_ROOT);
}

function themeDir(id, options = {}) {
  return assertThemePathSafe(themeRoot(options), path.join(themeRoot(options), String(id || '')));
}

function writeThemeFile(baseDir, relativePath, content) {
  const normalized = normalizePath(relativePath);
  const fullPath = assertThemePathSafe(baseDir, path.join(baseDir, normalized));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, String(content ?? ''), 'utf8');
}

function saveGeneratedTheme(pkg, options = {}) {
  const validation = validateThemePackage(pkg);
  if (!validation.ok) {
    const error = new Error(`theme package invalid: ${validation.errors.join('; ')}`);
    error.validation = validation;
    throw error;
  }

  const id = options.id || createThemeId();
  const dir = themeDir(id, options);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    ...pkg.manifest,
    id,
    status: options.status || 'preview',
    score: Number(options.score || 0),
    design_note: pkg.design_note || pkg.manifest.design_note || '',
    created_at: options.created_at || timestamp(),
  };

  writeThemeFile(dir, 'theme.json', JSON.stringify(manifest, null, 2));
  for (const [relativePath, content] of Object.entries(pkg.files || {})) {
    writeThemeFile(dir, relativePath, content);
  }

  return { id, status: manifest.status, path: dir, manifest };
}

function readThemeManifest(id, options = {}) {
  const filePath = path.join(themeDir(id, options), 'theme.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readThemeTemplate(id, pageName, options = {}) {
  const filePath = path.join(themeDir(id, options), 'templates', `${pageName}.ejs`);
  return fs.readFileSync(filePath, 'utf8');
}

function defaultSampleData() {
  return {
    siteTitle: 'AI 智能网站',
    siteDescription: 'AI generated website',
    siteLanguage: 'zh-CN',
    siteUrl: 'https://example.com',
    currentPath: '/',
    themeAssetUrl: '/themes/sample/assets/theme.css',
    metaDescription: 'AI generated website',
    metaKeywords: '',
    categories: [{ id: 1, name: '资讯', slug: 'news', description: '最新资讯' }],
    category: { id: 1, name: '资讯', slug: 'news', description: '最新资讯' },
    latest: [],
    featured: [],
    articles: [],
    allArticles: [],
    months: [],
    q: '',
    total: 0,
    pagination: { totalItems: 0, totalPages: 1, currentPage: 1, startItem: 0, endItem: 0, items: [] },
    article: {
      id: 1,
      title: '示例文章',
      slug: 'sample',
      summary: '示例摘要',
      content_html: '<p>示例正文</p>',
      category_name: '资讯',
      category_slug: 'news',
      published_at: '2026-01-01 10:00:00',
    },
    prevArticle: null,
    nextArticle: null,
    relatedArticles: [],
    topicPath: [],
    wordCount: 1200,
    readTime: 3,
  };
}

function renderThemeTemplate(id, pageName, data = {}, options = {}) {
  const dir = themeDir(id, options);
  const filePath = path.join(dir, 'templates', `${pageName}.ejs`);
  const template = fs.readFileSync(filePath, 'utf8');
  const locals = { ...defaultSampleData(), ...data, pageName };
  locals.themeAssetUrl = data.themeAssetUrl || themeAssetUrl(id);
  locals.site = locals.site || {
    title: locals.siteTitle,
    description: locals.siteDescription,
    language: locals.siteLanguage,
    url: locals.siteUrl,
  };
  locals.post = locals.post || locals.article;
  return ejs.render(template, locals, { filename: filePath });
}

async function reviewTheme(id, options = {}) {
  const sampleData = { ...defaultSampleData(), ...(options.sampleData || {}) };
  const issues = [];
  let score = 100;

  let manifest;
  try {
    manifest = readThemeManifest(id, options);
  } catch (err) {
    return { pass: false, score: 0, issues: [`manifest: ${err.message}`], sampleData };
  }

  const files = {};
  for (const pageName of REQUIRED_TEMPLATES) files[`templates/${pageName}.ejs`] = readThemeTemplate(id, pageName, options);
  for (const partial of manifest.partials || []) {
    const partialPath = path.join(themeDir(id, options), 'partials', `${partial}.ejs`);
    files[`partials/${partial}.ejs`] = fs.existsSync(partialPath) ? fs.readFileSync(partialPath, 'utf8') : '';
  }
  for (const asset of manifest.assets || []) {
    const assetPath = path.join(themeDir(id, options), asset);
    files[asset] = fs.existsSync(assetPath) ? fs.readFileSync(assetPath, 'utf8') : '';
  }

  const validation = validateThemePackage({ manifest, files });
  if (!validation.ok) {
    issues.push(...validation.errors);
    score -= 40;
  }

  for (const pageName of REQUIRED_TEMPLATES) {
    try {
      const html = renderThemeTemplate(id, pageName, sampleData, options);
      if (!/<html|<body|<main|<section|<article/i.test(html)) {
        issues.push(`${pageName}: rendered HTML lacks page structure`);
        score -= 5;
      }
      if ((pageName === 'home' || pageName === 'article') && !/<title|meta name="description"|<article|<h1/i.test(html)) {
        issues.push(`${pageName}: SEO/readability structure missing`);
        score -= 8;
      }
    } catch (err) {
      issues.push(`${pageName}: ${err.message}`);
      score -= 30;
    }
  }

  const css = files['assets/theme.css'] || '';
  if (css.length < 30) {
    issues.push('assets/theme.css too small');
    score -= 10;
  }
  if (/position:\s*fixed[^}]+width:\s*100vw/i.test(css)) {
    issues.push('possible mobile overflow risk');
    score -= 8;
  }

  score = Math.max(0, Math.min(100, score));
  return {
    pass: score >= (options.passScore || REVIEW_PASS_SCORE) && issues.length === 0,
    score,
    issues,
    manifest,
    sampleData,
    reviewed_at: timestamp(),
  };
}

function themeAssetUrl(id, assetPath = 'assets/theme.css') {
  return `/themes/${encodeURIComponent(id)}/${normalizePath(assetPath)}`;
}

module.exports = {
  DEFAULT_THEME_ROOT,
  REVIEW_PASS_SCORE,
  createThemeId,
  themeRoot,
  themeDir,
  saveGeneratedTheme,
  readThemeManifest,
  readThemeTemplate,
  renderThemeTemplate,
  reviewTheme,
  defaultSampleData,
  themeAssetUrl,
};
