function providerSuffix(result) {
  return result?.provider ? ` (${result.provider})` : '';
}

function scoreSuffix(result) {
  return Number.isFinite(Number(result?.styleScore)) ? ` (${result.styleScore}分)` : '';
}

function buildArticleOutcomeLogs(page, result, options = {}) {
  const title = result?.title || page?.title || '未命名文章';
  const reviewerAction = options.reviewerAction || '审核文章';

  if (result?.published) {
    return [
      {
        role: 'writer',
        action: '撰写文章',
        status: 'success',
        detail: `完成: ${title}${providerSuffix(result)}`,
      },
      {
        role: 'reviewer',
        action: reviewerAction,
        status: 'success',
        detail: `通过: ${title}`,
      },
    ];
  }

  return [
    {
      role: 'writer',
      action: '撰写文章',
      status: 'success',
      detail: `生成待重写: ${title}${providerSuffix(result)}`,
    },
    {
      role: 'reviewer',
      action: reviewerAction,
      status: 'failed',
      detail: `未发布，等待重写: ${title}${scoreSuffix(result)}`,
    },
  ];
}

function logArticleOutcome(logAgent, page, result, options = {}) {
  for (const entry of buildArticleOutcomeLogs(page, result, options)) {
    logAgent(entry.role, entry.action, entry.status, entry.detail);
  }
}

module.exports = {
  buildArticleOutcomeLogs,
  logArticleOutcome,
};
