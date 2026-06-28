const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const themeDir = path.join(root, 'views', 'themes', 'aurora-press');
const requiredPages = ['home', 'category', 'article', 'archive', 'search', '404'];
const requiredPartials = ['head', 'header', 'footer', 'article-card', 'pagination'];

const sampleArticle = {
  id: 1,
  title: '生成式搜索进入深水区',
  slug: 'generative-search-deep',
  summary: '搜索体验正在从链接列表变成可验证的知识工作流。',
  category_name: '产业观察',
  category_slug: 'industry',
  published_at: '2026-06-29 08:12:33',
  view_count: 128,
  content_html: '<p>这是一篇用于模板渲染的测试文章。</p><h2>关键变化</h2><p>内容需要保持可读。</p>',
  seo_keywords: 'AI,搜索',
  image_review_status: 'pass',
  cover_image: '/generated-images/articles/sample.png',
  cover_thumbnail: '/generated-images/articles/sample-thumb.png',
  card_image: '/generated-images/articles/sample-card.png',
  image_alt: '抽象但清晰的搜索工作流界面',
};

const pagination = {
  totalPages: 2,
  currentPage: 1,
  totalItems: 18,
  startItem: 1,
  endItem: 12,
  prevHref: null,
  nextHref: '/archive?page=2',
  items: [
    { type: 'page', page: 1, href: '/archive?page=1', isCurrent: true },
    { type: 'page', page: 2, href: '/archive?page=2', isCurrent: false },
  ],
};

function locals(extra = {}) {
  return {
    siteLanguage: 'zh-CN',
    siteTitle: 'AI 纪元',
    siteDescription: '追踪智能技术与产业变化',
    siteUrl: 'https://aiweb.bt199.com',
    currentPath: '/',
    categories: [
      { name: '产业观察', slug: 'industry', description: '观察技术商业化进程' },
      { name: '产品评测', slug: 'reviews', description: '拆解工具和产品体验' },
    ],
    friendLinks: [],
    title: 'AI 纪元',
    metaDescription: '追踪智能技术与产业变化',
    ...extra,
  };
}

test('aurora press theme includes all required frontend pages, partials, and stylesheet', () => {
  for (const page of requiredPages) {
    assert.equal(fs.existsSync(path.join(themeDir, `${page}.ejs`)), true, `${page}.ejs should exist`);
  }
  for (const partial of requiredPartials) {
    assert.equal(fs.existsSync(path.join(themeDir, 'partials', `${partial}.ejs`)), true, `${partial}.ejs should exist`);
  }
  assert.equal(fs.existsSync(path.join(root, 'public', 'css', 'themes', 'aurora-press.css')), true);
});

test('aurora press theme renders core public pages with its own visual system', async () => {
  const renderOptions = { views: [themeDir, path.join(themeDir, 'partials')] };
  const pages = {
    home: locals({ featured: [sampleArticle], latest: [sampleArticle] }),
    category: locals({ title: '产业观察', category: { name: '产业观察', slug: 'industry', description: '观察技术商业化进程' }, articles: [sampleArticle], pagination }),
    article: locals({ title: sampleArticle.title, article: sampleArticle, prevArticle: null, nextArticle: null, relatedArticles: [sampleArticle], topicPath: [sampleArticle], wordCount: 1200, readTime: 3 }),
    archive: locals({ title: '文章归档', archive: [['2026-06', [sampleArticle]]], totalArticles: 1, totalMonths: 1, startArticle: 1, endArticle: 1, pagination }),
    search: locals({ title: '搜索', q: 'AI', articles: [sampleArticle], pagination, total: 1 }),
    404: locals({ title: '页面未找到', latest: [sampleArticle] }),
  };

  for (const [page, data] of Object.entries(pages)) {
    const html = await ejs.renderFile(path.join(themeDir, `${page}.ejs`), data, renderOptions);
    assert.match(html, /\/css\/themes\/aurora-press\.css/);
    assert.match(html, /class="ap-/);
    assert.doesNotMatch(html, /\/css\/style\.css/);
  }
});

test('aurora press head tolerates pages without optional SEO fields', async () => {
  const renderOptions = { views: [themeDir, path.join(themeDir, 'partials')] };
  const data = locals({
    title: '文章归档',
    archive: [],
    totalArticles: 0,
    totalMonths: 0,
    startArticle: 0,
    endArticle: 0,
    pagination: { totalPages: 0 },
  });
  delete data.metaDescription;
  delete data.metaKeywords;

  const html = await ejs.renderFile(
    path.join(themeDir, 'archive.ejs'),
    data,
    renderOptions,
  );

  assert.match(html, /\/css\/themes\/aurora-press\.css/);
  assert.match(html, /class="ap-/);
});

test('template development manual explains how to build a new frontend template without reading source code', () => {
  const manualPath = path.join(root, 'docs', 'template-development-manual.md');
  const manual = fs.readFileSync(manualPath, 'utf8');

  assert.match(manual, /模板开发操作手册/);
  assert.match(manual, /必需页面/);
  assert.match(manual, /home/);
  assert.match(manual, /article/);
  assert.match(manual, /category/);
  assert.match(manual, /archive/);
  assert.match(manual, /search/);
  assert.match(manual, /404/);
  assert.match(manual, /后台切换/);
  assert.match(manual, /测试清单/);
});
