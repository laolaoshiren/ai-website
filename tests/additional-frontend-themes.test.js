const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const requiredPages = ['home', 'category', 'article', 'archive', 'search', '404'];
const requiredPartials = ['head', 'header', 'footer', 'article-card', 'pagination'];

const themes = [
  { id: 'ink-scroll', css: 'ink-scroll.css', marker: 'class="ink-', layoutMarker: 'ink-manuscript' },
  { id: 'star-harbor', css: 'star-harbor.css', marker: 'class="sh-', layoutMarker: 'sh-command-center' },
  { id: 'lumen-flow', css: 'lumen-flow.css', marker: 'class="lf-', layoutMarker: 'lf-hero' },
  { id: 'neo-blog', css: 'neo-blog.css', marker: 'class="nb-', layoutMarker: 'nb-showcase' },
];

const article = {
  id: 1,
  title: 'AI 内容站进入自动运营阶段',
  slug: 'ai-site-autonomy',
  summary: '从内容规划、生成、审核到前台呈现，系统正在形成完整闭环。',
  category_name: '深度观察',
  category_slug: 'insight',
  published_at: '2026-06-29 10:11:12',
  view_count: 256,
  content_html: '<p>这是一篇用于模板渲染的测试文章。</p><h2>关键变化</h2><p>模板需要保持可读和稳定。</p>',
  seo_keywords: 'AI,自动运营',
  image_review_status: 'pass',
  cover_image: '/generated-images/articles/sample.png',
  cover_thumbnail: '/generated-images/articles/sample-thumb.png',
  card_image: '/generated-images/articles/sample-card.png',
  image_alt: '清晰的自动化内容工作台',
};

const pagination = {
  totalPages: 2,
  currentPage: 1,
  totalItems: 16,
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
      { name: '深度观察', slug: 'insight', description: '长期观察智能产业变化' },
      { name: '工具实践', slug: 'tools', description: '记录可复用的 AI 工具方法' },
    ],
    friendLinks: [],
    title: 'AI 纪元',
    metaDescription: '追踪智能技术与产业变化',
    ...extra,
  };
}

test('additional frontend themes include all required SDK files', () => {
  for (const theme of themes) {
    const themeDir = path.join(root, 'views', 'themes', theme.id);
    for (const page of requiredPages) {
      assert.equal(fs.existsSync(path.join(themeDir, `${page}.ejs`)), true, `${theme.id}/${page}.ejs should exist`);
    }
    for (const partial of requiredPartials) {
      assert.equal(fs.existsSync(path.join(themeDir, 'partials', `${partial}.ejs`)), true, `${theme.id}/${partial}.ejs should exist`);
    }
    assert.equal(fs.existsSync(path.join(root, 'public', 'css', 'themes', theme.css)), true, `${theme.css} should exist`);
  }
});

test('additional frontend themes render every public page with independent CSS and classes', async () => {
  for (const theme of themes) {
    const themeDir = path.join(root, 'views', 'themes', theme.id);
    const renderOptions = { views: [themeDir, path.join(themeDir, 'partials')] };
    const pages = {
      home: locals({ featured: [article], latest: [article] }),
      category: locals({ title: '深度观察', category: { name: '深度观察', slug: 'insight', description: '长期观察智能产业变化' }, articles: [article], pagination }),
      article: locals({ title: article.title, article, prevArticle: null, nextArticle: null, relatedArticles: [article], topicPath: [article], wordCount: 1200, readTime: 3 }),
      archive: locals({ title: '文章归档', archive: [['2026-06', [article]]], totalArticles: 1, totalMonths: 1, startArticle: 1, endArticle: 1, pagination }),
      search: locals({ title: '搜索', q: 'AI', articles: [article], pagination, total: 1 }),
      404: locals({ title: '页面未找到', latest: [article] }),
    };

    for (const [page, data] of Object.entries(pages)) {
      const html = await ejs.renderFile(path.join(themeDir, `${page}.ejs`), data, renderOptions);
      assert.match(html, new RegExp(`/css/themes/${theme.css.replace('.', '\\.')}`));
      assert.match(html, new RegExp(theme.marker));
      if (page === 'home') assert.match(html, new RegExp(theme.layoutMarker));
      assert.doesNotMatch(html, /\/css\/style\.css/);
      assert.doesNotMatch(html, /\/css\/themes\/aurora-press\.css/);
    }
  }
});

