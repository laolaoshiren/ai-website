/**
 * 规划 Agent - 网站结构规划（集成联网搜索）
 */
const { callAIForJSON } = require('./client');
const { getPlannerPrompt } = require('./prompts');
const { getCategories, getAllPages, upsertCategory, insertPage, getAnalyticsSummary, getSetting, getPageBySlug, getCategoryBySlug } = require('../db/database');
const { slugify } = require('./utils');
const { getLatestNews, searchWeb } = require('./search');
const { selectCategoriesForPlanning } = require('./category-policy');

async function planStructure() {
  const existingCategories = getCategories();
  const existingArticles = getAllPages('published');
  const analyticsSummary = getAnalyticsSummary(30);
  const site = require('../config').getSiteConfig();
  const isColdStart = existingCategories.length === 0 && existingArticles.length === 0;

  // 🔍 获取最新热点新闻用于规划参考
  let latestNews = [];
  try {
    console.log('  🔍 获取最新热点资讯...');
    latestNews = await getLatestNews(5);
    // 如果有主题，额外搜索主题相关
    if (site.theme) {
      const topicNews = await searchWeb(site.theme, 3);
      latestNews.push(...topicNews);
    }
    console.log(`  ✅ 获取到 ${latestNews.length} 条最新资讯`);
  } catch (err) {
    console.log('  ⚠️ 获取资讯跳过:', err.message);
  }

  const messages = getPlannerPrompt(existingCategories, existingArticles, analyticsSummary, latestNews);
  const { data, model, tokensUsed, provider } = await callAIForJSON(messages, {
    taskType: 'plan_structure',
    maxTokens: 4096,
  });

  const acceptedCategories = selectCategoriesForPlanning(existingCategories, data.categories, { isColdStart });
  for (const cat of acceptedCategories) {
    upsertCategory(cat.slug, cat.name, cat.description, cat.sort_order || 0, null);
  }

  // 创建内容计划（存储为 planned 状态的文章）
  if (data.content_plan && Array.isArray(data.content_plan)) {
    // 构建已有标题前缀索引（用于去重）
    const existingTitlePrefixes = new Set();
    existingArticles.forEach(a => {
      const prefix = (a.title || '').replace(/[\s\-—：:，,。.!！?？]/g, '').slice(0, 12).toLowerCase();
      if (prefix) existingTitlePrefixes.add(prefix);
    });

    // 统计总文章数
    const totalArticles = existingArticles.length;
    let created = 0;

    for (const plan of data.content_plan) {
      if (created >= 5) break; // 每次规划最多 5 篇

      const slug = slugify(plan.title);
      const existing = getPageBySlug(slug);
      if (existing) continue;

      // 标题相似度去重：检查前12字是否重复
      const titlePrefix = (plan.title || '').replace(/[\s\-—：:，,。.!！?？]/g, '').slice(0, 12).toLowerCase();
      if (existingTitlePrefixes.has(titlePrefix)) continue;

      let categoryId = null;
      if (plan.category_slug) {
        const cat = getCategoryBySlug(plan.category_slug);
        if (cat) categoryId = cat.id;
      }

      insertPage({
        slug,
        title: plan.title,
        category_id: categoryId,
        summary: plan.summary || '',
        content_md: '',
        content_html: '',
        status: 'planned',
        seo_keywords: (plan.keywords || []).join(', '),
      });
      existingTitlePrefixes.add(titlePrefix);
      created++;
    }
  }

  // 保存策略说明
  if (data.strategy_notes) {
    const { setSetting } = require('../db/database');
    setSetting('last_strategy_notes', data.strategy_notes);
  }

  return { categories: acceptedCategories.length, articles: data.content_plan?.length || 0, model, tokensUsed, provider };
}

module.exports = { planStructure };
