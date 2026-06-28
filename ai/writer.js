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

function buildQualityRetryGuidance(page = {}) {
  const lastError = String(page.last_error || '').trim();
  const attemptCount = Number(page.attempt_count || 0);
  if (!lastError && attemptCount <= 1) return '';

  const lines = [
    `上一轮尝试没有成功，这是第 ${attemptCount || 1} 次尝试。`,
  ];

  if (/style_check_failed|未达标|待写重试|等待重写/i.test(lastError)) {
    lines.push(`失败原因: ${lastError || 'style_check_failed'}`);
    lines.push('不要重复上一轮的写法。换一个更具体的切口，减少模板化小标题，多写可核查事实、场景和明确判断。');
  } else if (/JSON|解析|返回内容为空|empty/i.test(lastError)) {
    lines.push(`失败原因: ${lastError}`);
    lines.push('这一轮必须只返回合法 JSON，不要在 JSON 前后添加解释、Markdown 围栏或多余文字。');
  } else if (lastError) {
    lines.push(`失败原因: ${lastError}`);
    lines.push('先规避上一轮失败点，再完成正文，不要机械复用旧稿结构。');
  }

  return lines.join('\n');
}

function compactMoACandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      provider: candidate.provider || candidate.name || '',
      model: candidate.model || '',
    }))
    .filter((candidate) => candidate.provider || candidate.model);
}

function buildAIMeta(result = {}) {
  const aiMode = result.moaFallback ? 'moa_fallback' : result.moa ? 'moa' : 'single';
  return {
    provider: result.provider || '',
    model: result.model || '',
    tokensUsed: result.tokensUsed || 0,
    ai_mode: aiMode,
    moa_candidates: compactMoACandidates(result.candidates),
    moa_failed_candidates: Number(result.failedCandidates || 0),
    moa_error: result.moaError || '',
  };
}

function buildArticleImageUpdates(imageResult) {
  if (!imageResult || imageResult.skipped || !imageResult.coverImage || imageResult.review?.status !== 'pass') return {};
  return {
    cover_image: imageResult.coverImage,
    image_alt: imageResult.imageAlt || null,
    image_prompt: imageResult.imagePrompt || null,
    image_review_status: imageResult.review.status,
    image_review_reason: imageResult.review.reason || null,
    image_provider: imageResult.provider || null,
    image_model: imageResult.model || null,
    image_generated_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' '),
  };
}

async function generateArticle(page) {
  const { getPublishedPages, updatePage, getCategories, getImageProviders, logAgent, retryTimeAfterAttempts } = require('../db/database');

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
  const messages = getWriterPrompt(page.title, category, keywords, page.summary, existingArticles, searchResults, {
    qualityRetryGuidance: buildQualityRetryGuidance(page),
  });
  const aiResult = await callAIForJSON(messages, {
    taskType: 'generate_content',
    maxTokens: 8192,
    temperature: 0.75,
  });
  const { data, model, tokensUsed, provider } = aiResult;
  const aiMeta = buildAIMeta(aiResult);

  // 发布前去 AI 味质检与自动重写
  const prepared = await prepareArticleForPublication(data, {
    articleTitle: page.title,
    category,
    keywords,
    searchResults,
  });
  const finalData = prepared.article;
  if (prepared.meta.style_status === 'rewritten') {
    logAgent('editor', '去AI味重写', 'success', `已重写: ${finalData.title} (${prepared.meta.style_score}分)`, aiMeta);
  } else if (!prepared.publishable) {
    logAgent('editor', '去AI味质检', 'failed', `未达标，保留待写重试: ${finalData.title} (${prepared.meta.style_score}分)`, aiMeta);
  } else {
    logAgent('editor', '去AI味质检', 'success', `通过: ${finalData.title} (${prepared.meta.style_score}分)`, aiMeta);
  }

  // 渲染
  const rawHtml = marked(finalData.content_md || '');
  const DOMPurify = createDOMPurify();
  const cleanHtml = DOMPurify.sanitize(rawHtml);

  let imageResult = null;
  if (prepared.publishable) {
    try {
      const { getConfig } = require('../config');
      const { shouldAttemptArticleImage, generateArticleImage } = require('./article-image');
      const imageArticle = {
        ...page,
        title: finalData.title || page.title,
        summary: finalData.summary || page.summary,
        content_md: finalData.content_md || '',
        content_html: cleanHtml,
        category_name: category?.name || page.category_name || '',
      };
      const config = getConfig();
      const imageProviders = getImageProviders();
      const imageDecision = shouldAttemptArticleImage(imageArticle, config, imageProviders);
      if (imageDecision.ok) {
        logAgent('image_designer', '生成文章配图', 'running', `配图: ${imageArticle.title}`, aiMeta);
        imageResult = await generateArticleImage(imageArticle, { config });
        if (imageResult.skipped) {
          const role = /review/i.test(imageResult.reason || '') ? 'image_reviewer' : 'image_designer';
          const status = /review/i.test(imageResult.reason || '') ? 'failed' : 'success';
          logAgent(role, role === 'image_reviewer' ? '审核文章配图' : '生成文章配图', status, `跳过配图: ${imageArticle.title} (${imageResult.reason || 'skipped'})`, { provider: imageResult.provider || '', model: imageResult.model || '' });
        } else {
          logAgent('image_reviewer', '审核文章配图', 'success', `通过: ${imageArticle.title}`, { provider: imageResult.provider || '', model: imageResult.model || '' });
        }
      }
    } catch (err) {
      logAgent('image_designer', '生成文章配图', 'failed', `跳过配图: ${(finalData.title || page.title)} - ${err.message}`);
    }
  }
  const imageUpdates = buildArticleImageUpdates(imageResult);

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
    next_retry_at: prepared.publishable ? null : retryTimeAfterAttempts(page.attempt_count),
    last_error: prepared.publishable ? null : 'style_check_failed',
    claimed_by: null,
    claimed_at: null,
    lock_expires_at: null,
    ai_mode: aiMeta.ai_mode,
    ai_provider: provider || '',
    ai_model: model || '',
    ai_tokens_used: tokensUsed || 0,
    ai_moa_candidates: JSON.stringify(aiMeta.moa_candidates || []),
    ai_moa_failed_candidates: aiMeta.moa_failed_candidates || 0,
    ai_moa_error: aiMeta.moa_error || null,
    ...prepared.meta,
    ...imageUpdates,
  });

  return {
    title: finalData.title || page.title,
    model,
    provider,
    tokensUsed,
    ai_mode: aiMeta.ai_mode,
    moa_candidates: aiMeta.moa_candidates,
    moa_failed_candidates: aiMeta.moa_failed_candidates,
    moa_error: aiMeta.moa_error,
    searchUsed: searchResults.length > 0,
    styleScore: prepared.meta.style_score,
    published: prepared.publishable,
    imageGenerated: !!imageUpdates.cover_image,
    imageProvider: imageUpdates.image_provider || '',
    imageModel: imageUpdates.image_model || '',
  };
}

module.exports = { generateArticle, prepareArticleForPublication, buildQualityRetryGuidance, buildAIMeta, buildArticleImageUpdates };
