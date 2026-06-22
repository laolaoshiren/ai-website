/**
 * 前台路由 - 首页、分类、文章、SEO 文件
 */
const express = require('express');
const router = express.Router();
const { getPublishedPages, getPageBySlug, getCategoryBySlug, getCategories } = require('../db/database');
const { getConfig } = require('../config');

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

// 分类页
router.get('/category/:slug', (req, res) => {
  const category = getCategoryBySlug(req.params.slug);
  if (!category) return res.status(404).render('pages/404', { title: '栏目不存在' });
  const page = parseInt(req.query.page) || 1;
  const limit = 12;
  const articles = getPublishedPages(limit, (page - 1) * limit, category.id);
  res.render('pages/category', {
    title: category.name,
    category, articles, page, hasMore: articles.length === limit,
    metaDescription: category.description,
  });
});

// 文章详情
router.get('/article/:slug', (req, res) => {
  const article = getPageBySlug(req.params.slug);
  if (!article || article.status !== 'published') {
    return res.status(404).render('pages/404', { title: '文章不存在' });
  }
  res.render('pages/article', {
    title: article.seo_title || article.title,
    article,
    metaDescription: article.seo_description || article.summary,
    metaKeywords: article.seo_keywords,
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
    xml += `  <url><loc>${siteUrl}/category/${cat.slug}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
  }
  for (const page of pages) {
    xml += `  <url><loc>${siteUrl}/article/${page.slug}</loc><lastmod>${(page.updated_at || '').split(' ')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
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
    xml += `    <link>${siteUrl}/article/${page.slug}</link>\n`;
    xml += `    <description>${escapeXml(page.summary || '')}</description>\n`;
    xml += `    <pubDate>${page.published_at ? new Date(page.published_at).toUTCString() : ''}</pubDate>\n`;
    xml += '  </item>\n';
  }
  xml += '</channel></rss>';

  res.set('Content-Type', 'application/rss+xml');
  res.send(xml);
});

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = router;
