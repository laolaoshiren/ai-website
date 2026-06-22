/**
 * 写作 Agent - 高质量内容生成（集成联网搜索）
 */
const { callAIForJSON } = require('./client');
const { getWriterPrompt } = require('./prompts');
const { marked } = require('marked');
const { createDOMPurify } = require('./utils');
const { searchWeb } = require('./search');

async function generateArticle(page) {
  const { getPublishedPages, getCategoryBySlug, updatePage } = require('../db/database');

  // 获取分类信息
  let category = null;
  if (page.category_id) {
    const { getCategories } = require('../db/database');
    const cats = getCategories();
    category = cats.find(c => c.id === page.category_id) || null;
  }

  const existingArticles = getPublishedPages(20);
  const keywords = page.seo_keywords ? page.seo_keywords.split(',').map(k => k.trim()) : [];

  // 🔍 联网搜索：先搜索相关最新信息
  let searchResults = [];
  try {
    const searchQuery = page.title + ' ' + (keywords.slice(0, 2).join(' '));
    console.log(`  🔍 搜索最新信息: ${searchQuery}`);
    searchResults = await searchWeb(searchQuery, 5);
    if (searchResults.length > 0) {
      console.log(`  ✅ 找到 ${searchResults.length} 条最新信息`);
    }
  } catch (err) {
    console.log(`  ⚠️ 搜索跳过: ${err.message}`);
  }

  const messages = getWriterPrompt(page.title, category, keywords, page.summary, existingArticles, searchResults);
  const { data, model, tokensUsed } = await callAIForJSON(messages, {
    taskType: 'generate_content',
    maxTokens: 8192,
    temperature: 0.75,
  });

  // 渲染 Markdown → HTML
  const rawHtml = marked(data.content_md || data.content || '');
  const DOMPurify = createDOMPurify();
  const cleanHtml = DOMPurify.sanitize(rawHtml);

  // 更新文章
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  updatePage(page.id, {
    title: data.title || page.title,
    summary: data.summary || page.summary,
    content_md: data.content_md || data.content || '',
    content_html: cleanHtml,
    seo_title: data.seo_title || null,
    seo_description: data.seo_description || null,
    seo_keywords: data.seo_keywords || null,
    schema_json: data.schema_json || null,
    status: 'published',
    published_at: now,
  });

  return { title: data.title || page.title, model, tokensUsed, searchUsed: searchResults.length > 0 };
}

module.exports = { generateArticle };
