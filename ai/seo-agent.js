/**
 * SEO Agent - 技术 SEO 优化
 */
const fs = require('fs');
const path = require('path');
const { callAIForJSON } = require('./client');
const { getSEOPrompt } = require('./prompts');
const { getPublishedPages, getCategories } = require('../db/database');
const { getConfig } = require('../config');

async function updateSEO() {
  const pages = getPublishedPages(1000);
  const categories = getCategories();
  const config = getConfig();
  const siteUrl = config.site_url || 'http://localhost:3000';

  // 同时更新 sitemap 和 robots.txt（这些可以本地生成，不需要 AI）
  generateSitemap(pages, categories, siteUrl);
  generateRobotsTxt(siteUrl);
  generateRSS(pages, config, siteUrl);

  // 可选：让 AI 分析 SEO 问题
  if (pages.length > 5) {
    try {
      const messages = getSEOPrompt(pages, categories, siteUrl);
      const { data } = await callAIForJSON(messages, {
        taskType: 'seo_update',
        maxTokens: 4096,
      });

      // 处理 AI 返回的 SEO 问题
      if (data.seo_issues) {
        const { updatePage } = require('../db/database');
        for (const issue of data.seo_issues) {
          const page = pages.find(p => p.slug === issue.page_slug);
          if (page && issue.fix) {
            // 记录建议，但不自动修改（避免破坏内容）
            console.log(`SEO 建议 [${issue.page_slug}]: ${issue.issue} → ${issue.fix}`);
          }
        }
      }
      return { pages: pages.length, model: 'seo', issues: data.seo_issues?.length || 0 };
    } catch (err) {
      console.error('SEO Agent 分析失败（已跳过）:', err.message);
    }
  }

  return { pages: pages.length };
}

function generateSitemap(pages, categories, siteUrl) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += `  <url><loc>${siteUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
  for (const cat of categories) {
    xml += `  <url><loc>${siteUrl}/category/${cat.slug}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
  }
  for (const page of pages) {
    const lastmod = (page.updated_at || '').split(' ')[0];
    xml += `  <url><loc>${siteUrl}/article/${page.slug}</loc>`;
    if (lastmod) xml += `<lastmod>${lastmod}</lastmod>`;
    xml += `<changefreq>weekly</changefreq><priority>${page.featured ? '0.9' : '0.6'}</priority></url>\n`;
  }
  xml += '</urlset>';

  const filePath = path.join(__dirname, '..', 'public', 'sitemap.xml');
  fs.writeFileSync(filePath, xml, 'utf8');
}

function generateRobotsTxt(siteUrl) {
  const txt = `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  const filePath = path.join(__dirname, '..', 'public', 'robots.txt');
  fs.writeFileSync(filePath, txt, 'utf8');
}

function generateRSS(pages, config, siteUrl) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n';
  xml += `  <title>${escapeXml(config.site_title || 'AI 智能网站')}</title>\n`;
  xml += `  <link>${siteUrl}</link>\n`;
  xml += `  <description>${escapeXml(config.site_description || '')}</description>\n`;
  xml += `  <language>${config.site_language || 'zh-CN'}</language>\n`;
  xml += `  <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>\n`;
  for (const page of pages.slice(0, 20)) {
    xml += '  <item>\n';
    xml += `    <title>${escapeXml(page.title)}</title>\n`;
    xml += `    <link>${siteUrl}/article/${page.slug}</link>\n`;
    xml += `    <guid isPermaLink="true">${siteUrl}/article/${page.slug}</guid>\n`;
    xml += `    <description>${escapeXml(page.summary || '')}</description>\n`;
    if (page.published_at) xml += `    <pubDate>${new Date(page.published_at).toUTCString()}</pubDate>\n`;
    xml += '  </item>\n';
  }
  xml += '</channel></rss>';

  const filePath = path.join(__dirname, '..', 'public', 'rss.xml');
  fs.writeFileSync(filePath, xml, 'utf8');
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { updateSEO };
