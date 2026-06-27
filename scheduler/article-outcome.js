function providerSuffix(result) {
  return result?.provider ? ` (${result.provider})` : '';
}

function scoreSuffix(result) {
  return Number.isFinite(Number(result?.styleScore)) ? ` (${result.styleScore}分)` : '';
}

function buildArticleOutcomeLogs(page, result, options = {}) {
  const title = result?.title || page?.title || '未命名文章';
  const reviewerAction = options.reviewerAction || '审核文章';
  const meta = {
    provider: result?.provider || '',
    model: result?.model || '',
  };
  if (result?.ai_mode) meta.ai_mode = result.ai_mode;
  if (result?.moa_candidates) meta.moa_candidates = result.moa_candidates;
  if (result?.moa_failed_candidates) meta.moa_failed_candidates = result.moa_failed_candidates;
  if (result?.moa_error) meta.moa_error = result.moa_error;

  if (result?.published) {
    return [
      {
        role: 'writer',
        action: '撰写文章',
        status: 'success',
        detail: `完成: ${title}${providerSuffix(result)}`,
        meta,
      },
      {
        role: 'reviewer',
        action: reviewerAction,
        status: 'success',
        detail: `通过: ${title}`,
        meta,
      },
    ];
  }

  return [
    {
      role: 'writer',
      action: '撰写文章',
      status: 'success',
      detail: `生成待重写: ${title}${providerSuffix(result)}`,
      meta,
    },
    {
      role: 'reviewer',
      action: reviewerAction,
      status: 'failed',
      detail: `未发布，等待重写: ${title}${scoreSuffix(result)}`,
      meta,
    },
  ];
}

function logArticleOutcome(logAgent, page, result, options = {}) {
  for (const entry of buildArticleOutcomeLogs(page, result, options)) {
    logAgent(entry.role, entry.action, entry.status, entry.detail, entry.meta);
  }
}

module.exports = {
  buildArticleOutcomeLogs,
  logArticleOutcome,
};
