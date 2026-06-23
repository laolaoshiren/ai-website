/**
 * 写作 Agent - 带工具调用的高质量内容生成
 */
const { callAIForJSON } = require('./client');
const { getWriterPrompt } = require('./prompts');
const { getToolUsePrompt } = require('./tools');
const { marked } = require('marked');
const { createDOMPurify } = require('./utils');
const { searchWeb } = require('./search');
const { humanizeArticleDraft } = require('./humanized-writing');

function normalizeGeneratedData(data, fallback = {}) {
  return {
    title: data?.title || fallback.title || '',
    summary: data?.summary || fallback.summary || '',
    content_md: data?.content_md || data?.content || fallback.content_md || fallback.content || '',
    seo_title: data?.seo_title || fallback.seo_title || null,
    seo_description: data?.seo_description || fallback.seo_description || null,
    seo_keywords: data?.seo_keywords || fallback.seo_keywords || null,
    schema_json: data?.schema_json || fallback.schema_json || null,
  };
}

async function prepareArticleForPublication(data, context = {}) {
  const rawDraft = normalizeGeneratedData(data, { title: context.articleTitle });
  const runHumanizer = context.humanizeArticleDraft || humanizeArticleDraft;
  const result = await runHumanizer(rawDraft, {
    context,
    minHumanScore: context.minHumanScore || 78,
    maxRewriteRounds: context.maxRewriteRounds || 2,
  });
  const article = normalizeGeneratedData(result.draft, rawDraft);
  const audit = result.audit || { status: 'review', humanScore: 0, issues: [], metrics: {} };

  return {
    article,
    publishable: audit.status === 'pass',
    meta: {
      style_score: audit.humanScore,
      style_status: result.status,
      style_issues: JSON.stringify(audit.issues || []),
      style_metrics: JSON.stringify(audit.metrics || {}),
      style_rewrite_attempts: result.attempts || 0,
      style_checked_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' '),
    },
  };
}

async function generateArticle(page) {
  const { getPublishedPages, updatePage, getCategories, logAgent } = require('../db/database');

  let category = null;
  if (page.category_id) {
    const cats = getCategories();
    category = cats.find(c => c.id === page.category_id) || null;
  }

  const existingArticles = getPublishedPages(20);
  const keywords = page.seo_keywords ? page.seo_keywords.split(',').map(k => k.trim()) : [];

  // 🔍 先用 RSS 搜索获取相关最新信息
  let searchResults = [];
  try {
    const searchQuery = page.title + ' ' + (keywords.slice(0, 2).join(' '));
    logAgent('writer', '搜索资讯', 'running', `搜索: ${searchQuery}`);
    searchResults = await searchWeb(searchQuery, 5);
    if (searchResults.length > 0) {
      logAgent('writer', '搜索资讯', 'success', `找到 ${searchResults.length} 条相关资讯`);
    }
  } catch (err) {
    logAgent('writer', '搜索资讯', 'failed', err.message);
  }

  // 生成文章
  const messages = getWriterPrompt(page.title, category, keywords, page.summary, existingArticles, searchResults);
  const { data, model, tokensUsed } = await callAIForJSON(messages, {
    taskType: 'generate_content',
    maxTokens: 8192,
    temperature: 0.75,
  });

  // 发布前去 AI 味质检与自动重写
  const prepared = await prepareArticleForPublication(data, {
    articleTitle: page.title,
    category,
    keywords,
    searchResults,
  });
  const finalData = prepared.article;
  if (prepared.meta.style_status === 'rewritten') {
    logAgent('editor', '去AI味重写', 'success', `已重写: ${finalData.title} (${prepared.meta.style_score}分)`);
  } else if (!prepared.publishable) {
    logAgent('editor', '去AI味质检', 'failed', `未达标，保留待写重试: ${finalData.title} (${prepared.meta.style_score}分)`);
  } else {
    logAgent('editor', '去AI味质检', 'success', `通过: ${finalData.title} (${prepared.meta.style_score}分)`);
  }

  // 渲染
  const rawHtml = marked(finalData.content_md || '');
  const DOMPurify = createDOMPurify();
  const cleanHtml = DOMPurify.sanitize(rawHtml);

  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  updatePage(page.id, {
    title: finalData.title || page.title,
    summary: finalData.summary || page.summary,
    content_md: finalData.content_md || '',
    content_html: cleanHtml,
    seo_title: finalData.seo_title || null,
    seo_description: finalData.seo_description || null,
    seo_keywords: finalData.seo_keywords || null,
    schema_json: finalData.schema_json || null,
    status: prepared.publishable ? 'published' : 'planned',
    published_at: prepared.publishable ? now : null,
    ...prepared.meta,
  });

  return {
    title: finalData.title || page.title,
    model,
    tokensUsed,
    searchUsed: searchResults.length > 0,
    styleScore: prepared.meta.style_score,
    published: prepared.publishable,
  };
}

module.exports = { generateArticle, prepareArticleForPublication };
