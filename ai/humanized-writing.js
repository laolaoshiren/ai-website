const { auditArticleStyle } = require('./style-guardian');

function normalizeDraft(input, fallback = {}) {
  return {
    title: input?.title || fallback.title || '',
    summary: input?.summary || fallback.summary || '',
    content_md: input?.content_md || input?.content || fallback.content_md || fallback.content || '',
    seo_title: input?.seo_title || fallback.seo_title || null,
    seo_description: input?.seo_description || fallback.seo_description || null,
    seo_keywords: input?.seo_keywords || fallback.seo_keywords || null,
    schema_json: input?.schema_json || fallback.schema_json || null,
  };
}

function issueSummary(audit) {
  return (audit?.issues || [])
    .map((issue) => `- [${issue.code}] ${issue.label}: ${issue.detail}`)
    .join('\n');
}

function buildRewriteMessages(draft, audit, context = {}) {
  const title = context.articleTitle || draft.title;
  const category = context.category?.name || context.category || '未分类';
  const keywords = Array.isArray(context.keywords) ? context.keywords.join(', ') : (context.keywords || '');
  const searchContext = (context.searchResults || [])
    .slice(0, 5)
    .map((item) => `- ${item.title}\n  来源: ${item.url}\n  摘要: ${item.snippet || ''}`)
    .join('\n');

  return [
    {
      role: 'system',
      content: `你是中文内容站的资深编辑，负责把 AI 味重的稿子改成真人愿意读的文章。

目标不是伪装成人，而是提升真实阅读价值：少套话，少模板，少白皮书腔，多具体事实、多判断、多自然节奏。

硬性规则：
- 保留事实、产品名、数字、来源和核心观点，不要编造新事实。
- 禁止新增原文或素材里没有的数字、公司、报告、百分比、融资金额、日期或案例。
- 没有来源就不要写具体百分比、排名、同比变化、机构观点或“某报告显示”。
- 不要为了显得具体而编造细节；素材不足时，把判断写窄，或围绕原文已有事实重组。
- 删除“本文将/本文深入/总的来说/意义深远/挑战与机遇”等机器式外壳。
- 不要使用固定“引言/一二三四/结语”结构；小标题要像编辑起的自然标题。
- 不要为了凑字数写空泛大词。宁可短一点，也要有信息量。
- 每 300-500 字至少要有一个具体锚点：数字、时间、产品、公司、人物、场景、来源或明确判断。
- 允许短句和不完全对称的段落节奏。不要把每段都写成“观点 + 解释 + 小总结”。
- 标题优先控制在 18-32 个汉字，像真人编辑标题，不像 SEO 题库。

你必须只返回 JSON。`,
    },
    {
      role: 'user',
      content: `请重写这篇文章，让它通过 AI 味质检。

原计划标题：${title}
栏目：${category}
关键词：${keywords || '无'}

质检发现：
${issueSummary(audit)}

${searchContext ? `可引用素材：\n${searchContext}\n` : ''}

当前稿件：
标题：${draft.title}
摘要：${draft.summary}

正文：
${draft.content_md}

返回 JSON：
{
  "title": "新的文章标题",
  "summary": "自然、具体的摘要，150 字以内",
  "content_md": "重写后的 Markdown 正文",
  "seo_title": "SEO 标题，60 字以内",
  "seo_description": "SEO 描述，150 字以内",
  "seo_keywords": "关键词1, 关键词2, 关键词3"
}`,
    },
  ];
}

async function defaultRewriteFn({ draft, audit, context }) {
  const { callAIForJSON } = require('./client');
  const messages = buildRewriteMessages(draft, audit, context);
  const creatorModel = context.creatorModel || context.creator_model || context.ai_model || '';
  const result = await callAIForJSON(messages, {
    taskType: 'style_review',
    reviewCapability: 'writing',
    preferReviewerOverModel: creatorModel,
    maxTokens: 8192,
    temperature: 0.82,
  });
  const routing = result.reviewRouting || {};
  return {
    ...result.data,
    __reviewerMeta: {
      provider: result.provider || '',
      model: result.model || '',
      reason: routing.reason || '',
      creatorScore: routing.creatorScore,
      reviewerScore: routing.reviewerScore,
    },
  };
}

async function humanizeArticleDraft(draftInput, options = {}) {
  const minHumanScore = options.minHumanScore ?? 78;
  const maxRewriteRounds = options.maxRewriteRounds ?? 2;
  const rewriteFn = options.rewriteFn || defaultRewriteFn;
  const context = options.context || options;

  let bestDraft = normalizeDraft(draftInput);
  let bestAudit = auditArticleStyle(bestDraft, { minHumanScore });
  let bestReviewerMeta = null;
  let currentDraft = bestDraft;
  let currentAudit = bestAudit;

  if (currentAudit.status === 'pass') {
    return { status: 'passed', attempts: 0, draft: currentDraft, audit: currentAudit };
  }

  for (let attempt = 1; attempt <= maxRewriteRounds; attempt += 1) {
    const rewriteResult = await rewriteFn({ draft: currentDraft, audit: currentAudit, context, attempt });
    const rewritten = normalizeDraft(
      rewriteResult,
      currentDraft
    );
    const reviewerMeta = rewriteResult?.__reviewerMeta || null;
    const rewrittenAudit = auditArticleStyle(rewritten, { minHumanScore });

    if (rewrittenAudit.humanScore > bestAudit.humanScore) {
      bestDraft = rewritten;
      bestAudit = rewrittenAudit;
      bestReviewerMeta = reviewerMeta;
    }

    currentDraft = rewritten;
    currentAudit = rewrittenAudit;

    if (currentAudit.status === 'pass') {
      return { status: 'rewritten', attempts: attempt, draft: currentDraft, audit: currentAudit, reviewerMeta };
    }
  }

  return {
    status: bestAudit.status === 'pass' ? 'rewritten' : 'blocked',
    attempts: maxRewriteRounds,
    draft: bestDraft,
    audit: bestAudit,
    reviewerMeta: bestReviewerMeta,
  };
}

module.exports = {
  buildRewriteMessages,
  humanizeArticleDraft,
};
