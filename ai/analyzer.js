/**
 * 分析 Agent - 流量分析 + 策略调整
 */
const { callAIForJSON } = require('./client');
const { getAnalyzerPrompt } = require('./prompts');
const { getAnalyticsSummary, getCategories, getPublishedPages, insertPage, updatePage } = require('../db/database');
const { slugify } = require('./utils');

async function analyzeAndAdapt() {
  const analyticsSummary = getAnalyticsSummary(30);
  const categories = getCategories();
  const recentArticles = getPublishedPages(20);

  const messages = getAnalyzerPrompt(analyticsSummary, categories, recentArticles);
  const { data, model, tokensUsed } = await callAIForJSON(messages, {
    taskType: 'analyze',
    maxTokens: 4096,
  });

  const actions = [];

  // 执行内容空白填补
  if (data.content_gaps && Array.isArray(data.content_gaps)) {
    for (const gap of data.content_gaps) {
      const slug = slugify(gap.topic);
      const existing = require('../db/database').getPageBySlug(slug);
      if (existing) continue;

      let categoryId = null;
      if (gap.category_slug) {
        const cat = require('../db/database').getCategoryBySlug(gap.category_slug);
        if (cat) categoryId = cat.id;
      }

      insertPage({
        slug,
        title: gap.topic,
        category_id: categoryId,
        summary: gap.reason || '',
        status: 'planned',
        seo_keywords: (gap.keywords || []).join(', '),
      });
      actions.push(`添加新计划: ${gap.topic}`);
    }
  }

  // 记录优化建议（不自动执行修改）
  if (data.optimization_suggestions) {
    for (const sug of data.optimization_suggestions) {
      actions.push(`优化建议 [${sug.page_slug}]: ${sug.action} - ${sug.reason}`);
    }
  }

  return { insights: data.insights?.length || 0, actions, model, tokensUsed };
}

module.exports = { analyzeAndAdapt };
