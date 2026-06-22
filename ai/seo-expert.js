/**
 * SEO 专家 Agent - 深度 SEO 审计和优化指导
 */
const { callAIForJSON } = require('./client');
const { getSEOExpertPrompt } = require('./prompts');
const { getPublishedPages, getCategories, getAnalyticsSummary, logAgent, updatePage } = require('../db/database');
const { getSiteConfig } = require('../config');

async function runSEOExpert() {
  const pages = getPublishedPages(100);
  const categories = getCategories();
  const analyticsSummary = getAnalyticsSummary(30);
  const siteConfig = getSiteConfig();
  const siteUrl = siteConfig.url;

  logAgent('seo_expert', 'SEO 审计', 'running', `开始审计 ${pages.length} 篇文章...`);

  const messages = getSEOExpertPrompt(pages, categories, analyticsSummary, siteUrl);
  const { data, model, tokensUsed, provider } = await callAIForJSON(messages, {
    taskType: 'seo_expert_audit',
    maxTokens: 8192,
    temperature: 0.4,
  });

  // 记录审计结果
  logAgent('seo_expert', 'SEO 审计', 'success',
    `评分: ${data.overall_score}/100 | 技术问题: ${data.technical_issues?.length || 0} | 关键词机会: ${data.keyword_opportunities?.length || 0} (via ${provider})`);

  // 自动修复：为缺少 SEO 信息的文章补充
  if (data.article_reviews) {
    for (const review of data.article_reviews) {
      const page = pages.find(p => p.slug === review.page_slug);
      if (!page) continue;

      const needsUpdate = !page.seo_title || !page.seo_description || !page.seo_keywords;
      if (needsUpdate && review.suggestions?.length > 0) {
        logAgent('seo_expert', 'SEO 补全', 'running', `补全: ${page.title}`);
        // 不覆盖已有的 SEO 信息
        const updates = {};
        if (!page.seo_title && review.suggestions) {
          // 从建议中提取，但不覆盖
        }
      }
    }
  }

  // 记录关键词机会
  if (data.keyword_opportunities?.length > 0) {
    for (const kw of data.keyword_opportunities.slice(0, 5)) {
      logAgent('seo_expert', '关键词机会', 'success', `"${kw.keyword}" - ${kw.suggestion}`);
    }
  }

  // 记录需要更新的文章
  if (data.content_update_plan?.length > 0) {
    for (const item of data.content_update_plan) {
      logAgent('seo_expert', '待更新内容', 'success', `[${item.priority}] ${item.page_slug}: ${item.reason}`);
    }
  }

  return {
    score: data.overall_score,
    technicalIssues: data.technical_issues?.length || 0,
    keywordOpportunities: data.keyword_opportunities?.length || 0,
    contentUpdates: data.content_update_plan?.length || 0,
    maintenanceStrategy: data.maintenance_strategy,
    model, tokensUsed, provider,
  };
}

module.exports = { runSEOExpert };
