const DEFAULT_REFERENCE_COUNT = 3;
const MIN_SUCCESSFUL_CANDIDATES = 2;
const MOA_TASKS = new Set(['generate_content', 'humanize_content']);

function shouldUseMoA(options = {}, config = {}) {
  if (options.moa === false) return false;
  if (options.useTools) return false;
  if (config.moa_enabled !== '1') return false;
  return MOA_TASKS.has(options.taskType);
}

function candidateLabel(candidate, index) {
  const provider = candidate.provider || `candidate-${index + 1}`;
  const model = candidate.model ? ` / ${candidate.model}` : '';
  return `${index + 1}. ${provider}${model}`;
}

function buildAggregatorMessages(messages = [], candidates = [], options = {}) {
  const candidateText = candidates
    .map((candidate, index) => `${candidateLabel(candidate, index)}\n${candidate.content}`)
    .join('\n\n---\n\n');
  const jsonRule = options.jsonMode
    ? '\n\n你必须只返回合法 JSON，不要添加 Markdown 代码块、解释、前后缀文字。'
    : '';

  return [
    {
      role: 'system',
      content: `你正在执行 MoA（Mixture-of-Agents）聚合。下面是多个模型基于同一任务生成的候选结果。你的任务不是平均拼接，而是批判性综合：保留最具体、最可信、最有阅读价值的内容，删除重复、空话、模板化表达和没有依据的断言。不要新增候选结果或原始任务中没有支撑的事实。${jsonRule}\n\n候选结果：\n${candidateText}`,
    },
    ...messages,
  ];
}

function expandProviderModels(providers = []) {
  const candidates = [];
  for (const provider of providers) {
    const models = String(provider.model || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
    if (models.length === 0) {
      candidates.push(provider);
      continue;
    }
    for (const model of models) {
      candidates.push({ ...provider, model });
    }
  }
  return candidates;
}

async function runMoA(messages = [], options = {}, deps = {}) {
  const getProviders = deps.getProviders;
  const rankProviders = deps.rankProviders || ((items) => items);
  const callProvider = deps.callProvider;
  if (!getProviders || !callProvider) throw new Error('MoA 缺少 provider 依赖');

  const providers = rankProviders(getProviders().filter((provider) => provider.enabled !== false));
  const modelCandidates = expandProviderModels(providers);
  const referenceProviders = modelCandidates.slice(0, options.moaReferenceCount || DEFAULT_REFERENCE_COUNT);
  if (referenceProviders.length < MIN_SUCCESSFUL_CANDIDATES) {
    throw new Error('MoA 可用模型不足');
  }

  const settled = await Promise.allSettled(
    referenceProviders.map(async (provider) => {
      try {
        const result = await callProvider(provider, messages, { ...options, model: provider.model });
        if (deps.onSuccess) deps.onSuccess(provider, result);
        return {
          provider: result.provider || provider.name,
          providerId: result.providerId || provider.id,
          model: result.model || provider.model,
          content: result.content || '',
          tokensUsed: result.tokensUsed || 0,
        };
      } catch (err) {
        if (deps.onFailure) deps.onFailure(provider, err);
        throw err;
      }
    })
  );

  const candidates = settled
    .filter((item) => item.status === 'fulfilled' && String(item.value.content || '').trim())
    .map((item) => item.value);
  const failed = settled.filter((item) => item.status === 'rejected').length;

  if (candidates.length < MIN_SUCCESSFUL_CANDIDATES) {
    throw new Error(`MoA 候选结果不足: ${candidates.length}/${referenceProviders.length}`);
  }

  const aggregator = modelCandidates[0];
  const aggregatorMessages = buildAggregatorMessages(messages, candidates, options);
  const aggregateResult = await callProvider(aggregator, aggregatorMessages, { ...options, model: aggregator.model });
  if (deps.onSuccess) deps.onSuccess(aggregator, aggregateResult);

  const candidateTokens = candidates.reduce((sum, item) => sum + (item.tokensUsed || 0), 0);
  return {
    ...aggregateResult,
    provider: `MoA:${aggregateResult.provider || aggregator.name}`,
    model: aggregateResult.model || aggregator.model,
    providerId: aggregateResult.providerId || aggregator.id,
    tokensUsed: candidateTokens + (aggregateResult.tokensUsed || 0),
    moa: true,
    candidates,
    failedCandidates: failed,
  };
}

module.exports = {
  shouldUseMoA,
  buildAggregatorMessages,
  expandProviderModels,
  runMoA,
};
