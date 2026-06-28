/**
 * 前台路由 - 首页、分类、文章、SEO 文件
 */
const express = require('express');
const router = express.Router();
const { getPublishedPages, getPageBySlug, getCategoryBySlug, getCategories } = require('../db/database');
const { getConfig } = require('../config');
const { buildArchivePagination, ARCHIVE_ARTICLES_PER_PAGE } = require('./archive-pagination');
const { buildPagination } = require('./pagination');
const { buildArticleRelations } = require('./article-relations');

// 首页
router.get('/', (req, res) => {
  const featured = getPublishedPages(5, 0).filter(p => p.featured);
  const latest = getPublishedPages(12);
  const categories = getCategories();
  res.render('pages/home', {
    title: getConfig().site_title || 'AI 智能网站',
    featured, latest, categories,
    metaDescription: getConfig().site_description,
  });
});

// 首页加载更多（AJAX JSON）
router.get('/api/more-articles', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 2);
  const limit = 12;
  const articles = getPublishedPages(limit, (page - 1) * limit);
  const hasMore = articles.length === limit;
  res.json({
    articles: articles.map(a => ({
      id: a.id, title: a.title, slug: a.slug,
      summary: a.summary || '', category_name: a.category_name || '',
      category_slug: a.category_slug || '', view_count: a.view_count || 0,
      published_at: a.published_at || '',
      cover_image: a.cover_image || '',
      image_review_status: a.image_review_status || '',
    })),
    hasMore, page,
  });
});

// 分类页
router.get('/category/:slug', (req, res) => {
  const slug = decodeURIComponent(req.params.slug);
  const category = getCategoryBySlug(slug);
  if (!category) return res.status(404).render('pages/404', { title: '栏目不存在' });
  const limit = 12;
  const allArticles = getPublishedPages(10000, 0, category.id);
  const pagination = buildPagination({
    totalItems: allArticles.length,
    requestedPage: req.query.page,
    perPage: limit,
    basePath: `/category/${encodeSlug(category.slug)}`,
  });
  const articles = allArticles.slice(pagination.offset, pagination.offset + pagination.perPage);
  res.render('pages/category', {
    title: category.name,
    category, articles, pagination,
    metaDescription: category.description,
  });
});

// 搜索
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
  const pagination = buildPagination({
    totalItems: total,
    requestedPage: page,
    perPage: limit,
    basePath: '/search',
    query: { q },
  });
  const articles = results.slice(pagination.offset, pagination.offset + pagination.perPage);
  res.render('pages/search', { title: q ? '搜索: ' + q : '搜索', q, articles, pagination, total });
});

// 归档
router.get('/archive', (req, res) => {
  const all = getPublishedPages(10000);
  const pagination = buildArchivePagination(all, req.query.page, {
    perPage: ARCHIVE_ARTICLES_PER_PAGE,
  });
  res.render('pages/archive', { title: '文章归档', ...pagination });
});

// 文章详情
router.get('/article/:slug', (req, res) => {
  let slug;
  try { slug = decodeURIComponent(req.params.slug); } catch { return res.status(404).render('pages/404', { title: '页面未找到', latest: [] }); }
  const article = getPageBySlug(slug);
  if (!article || article.status !== 'published') {
    return res.status(404).render('pages/404', { title: '文章不存在' });
  }
  const config = getConfig();

  // 获取所有已发布文章，计算上下篇和相关推荐
  const allArticles = getPublishedPages(1000);
  const currentIndex = allArticles.findIndex(a => a.id === article.id);
  const prevArticle = currentIndex > 0 ? allArticles[currentIndex - 1] : null;
  const nextArticle = currentIndex < allArticles.length - 1 ? allArticles[currentIndex + 1] : null;

  // 相关文章与同主题阅读路径：同栏目、关键词重合和阅读量综合排序
  const { relatedArticles, topicPath } = buildArticleRelations(article, allArticles, {
    relatedLimit: 3,
    pathLimit: 4,
  });

  // 字数统计与阅读时间
  const plainText = (article.content_html || article.content_md || '').replace(/<[^>]*>/g, '');
  const wordCount = plainText.length;
  const readTime = Math.max(1, Math.round(wordCount / 500));

  res.render('pages/article', {
    title: article.seo_title || article.title,
    article,
    siteUrl: config.site_url || 'http://localhost:3000',
    metaDescription: article.seo_description || article.summary,
    metaKeywords: article.seo_keywords,
    prevArticle, nextArticle, relatedArticles, topicPath, wordCount, readTime,
  });
});

// Sitemap
router.get('/sitemap.xml', (req, res) => {
  const config = getConfig();
  const siteUrl = config.site_url || 'http://localhost:3000';
  const pages = getPublishedPages(1000);
  const categories = getCategories();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += `  <url><loc>${siteUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
  for (const cat of categories) {
    xml += `  <url><loc>${siteUrl}/category/${encodeSlug(cat.slug)}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
  }
  for (const page of pages) {
    xml += `  <url><loc>${siteUrl}/article/${encodeSlug(page.slug)}</loc><lastmod>${(page.updated_at || '').split(' ')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
  }
  xml += '</urlset>';

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// Robots.txt
router.get('/robots.txt', (req, res) => {
  const config = getConfig();
  const siteUrl = config.site_url || 'http://localhost:3000';
  const txt = `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  res.set('Content-Type', 'text/plain');
  res.send(txt);
});

// RSS
router.get('/rss.xml', (req, res) => {
  const config = getConfig();
  const siteUrl = config.site_url || 'http://localhost:3000';
  const pages = getPublishedPages(20);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0"><channel>\n';
  xml += `  <title>${config.site_title || 'AI 智能网站'}</title>\n`;
  xml += `  <link>${siteUrl}</link>\n`;
  xml += `  <description>${config.site_description || ''}</description>\n`;
  xml += `  <language>${config.site_language || 'zh-CN'}</language>\n`;
  for (const page of pages) {
    xml += '  <item>\n';
    xml += `    <title>${escapeXml(page.title)}</title>\n`;
    xml += `    <link>${siteUrl}/article/${encodeSlug(page.slug)}</link>\n`;
    xml += `    <description>${escapeXml(page.summary || '')}</description>\n`;
    xml += `    <pubDate>${page.published_at ? new Date(page.published_at).toUTCString() : ''}</pubDate>\n`;
    xml += '  </item>\n';
  }
  xml += '</channel></rss>';

  res.set('Content-Type', 'application/rss+xml');
  res.send(xml);
});

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * 编码 URL 路径中的 slug 部分（保留 / 和 scheme://host）
 */
function encodeSlug(slug) {
  // 对 slug 中的非 ASCII 字符做百分号编码
  return String(slug).split('/').map(part => {
    // 只编码包含非 ASCII 字符的部分
    if (/[^\x00-\x7F]/.test(part)) return encodeURIComponent(part);
    return part;
  }).join('/');
}

module.exports = router;
