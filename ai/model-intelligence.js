const DEFAULT_OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const SEEDED_FAMILIES = [
  { pattern: /claude/i, base: 940, reasoning: 955, writing: 940, vision: 900 },
  { pattern: /gpt/i, base: 910, reasoning: 920, writing: 900, vision: 890 },
  { pattern: /gemini/i, base: 900, reasoning: 910, writing: 875, vision: 930 },
  { pattern: /deepseek/i, base: 875, reasoning: 900, writing: 850, vision: 650 },
  { pattern: /qwen/i, base: 845, reasoning: 855, writing: 850, vision: 760 },
  { pattern: /llama|meta/i, base: 810, reasoning: 805, writing: 790, vision: 700 },
  { pattern: /mistral|mixtral/i, base: 790, reasoning: 785, writing: 770, vision: 650 },
  { pattern: /kimi|moonshot/i, base: 830, reasoning: 835, writing: 850, vision: 650 },
  { pattern: /yi|01-ai/i, base: 780, reasoning: 770, writing: 785, vision: 620 },
  { pattern: /glm|zhipu/i, base: 800, reasoning: 805, writing: 805, vision: 690 },
  { pattern: /agnes/i, base: 760, reasoning: 760, writing: 760, vision: 650 },
  { pattern: /mimo|xiaomi/i, base: 740, reasoning: 735, writing: 745, vision: 620 },
];

const KNOWN_MODEL_OVERRIDES = [
  { pattern: /claude.*4\.9.*opus|claude.*opus.*4\.9/i, base: 985, reasoning: 990, writing: 970, vision: 930 },
  { pattern: /claude.*4\.8.*opus|claude.*opus.*4\.8/i, base: 970, reasoning: 980, writing: 960, vision: 925 },
  { pattern: /claude.*4\.5.*opus|claude.*opus.*4\.5/i, base: 955, reasoning: 965, writing: 950, vision: 915 },
  { pattern: /claude.*sonnet/i, base: 930, reasoning: 940, writing: 930, vision: 900 },
  { pattern: /claude.*haiku/i, base: 835, reasoning: 820, writing: 830, vision: 840 },
  { pattern: /gpt-5/i, base: 975, reasoning: 980, writing: 950, vision: 930 },
  { pattern: /gpt-4\.1(?!.*mini)/i, base: 925, reasoning: 935, writing: 900, vision: 900 },
  { pattern: /gpt-4\.1.*mini/i, base: 835, reasoning: 820, writing: 815, vision: 820 },
  { pattern: /gpt-4o(?!.*mini)/i, base: 895, reasoning: 880, writing: 880, vision: 910 },
  { pattern: /gpt-4o.*mini/i, base: 805, reasoning: 790, writing: 785, vision: 820 },
  { pattern: /gemini.*2\.5.*pro/i, base: 930, reasoning: 945, writing: 900, vision: 950 },
  { pattern: /gemini.*2\.5.*flash/i, base: 850, reasoning: 840, writing: 820, vision: 875 },
  { pattern: /deepseek.*v4|deepseek.*r2/i, base: 910, reasoning: 935, writing: 875, vision: 650 },
  { pattern: /deepseek.*v3|deepseek.*r1/i, base: 880, reasoning: 910, writing: 850, vision: 620 },
  { pattern: /qwen3.*72b|qwen.*72b/i, base: 865, reasoning: 875, writing: 865, vision: 760 },
  { pattern: /qwen3.*32b|qwen.*32b/i, base: 840, reasoning: 850, writing: 845, vision: 740 },
  { pattern: /qwen3.*7b|qwen.*7b/i, base: 740, reasoning: 735, writing: 745, vision: 680 },
];

function normalizeModelName(modelName = '') {
  return String(modelName || '')
    .trim()
    .replace(/^.*\//, '')
    .toLowerCase();
}

function parseDelimitedList(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(item => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function versionBonus(name) {
  const matches = [...String(name || '').matchAll(/(?:^|[^a-z])v?(\d+)(?:\.(\d+))?/gi)];
  if (matches.length === 0) return 0;
  const versions = matches
    .map(match => Number(match[1] || 0) * 10 + Number(match[2] || 0))
    .filter(Number.isFinite);
  if (versions.length === 0) return 0;
  return Math.min(55, Math.max(...versions));
}

function parameterBonus(name) {
  const match = String(name || '').match(/(\d+)\s*b\b/i);
  if (!match) return 0;
  const size = Number(match[1]);
  if (size >= 400) return 45;
  if (size >= 100) return 32;
  if (size >= 70) return 24;
  if (size >= 32) return 16;
  if (size >= 14) return 8;
  if (size <= 8) return -35;
  return 0;
}

function tierAdjustment(name) {
  const value = String(name || '').toLowerCase();
  let score = 0;
  if (/\bopus\b|ultra|max|pro\b/.test(value)) score += 28;
  if (/sonnet|plus|turbo/.test(value)) score += 12;
  if (/flash|mini|lite|haiku|small|nano/.test(value)) score -= 70;
  if (/preview|experimental|beta/.test(value)) score -= 8;
  return score;
}

function seededBase(name) {
  const override = KNOWN_MODEL_OVERRIDES.find(item => item.pattern.test(name));
  if (override) return override;
  return SEEDED_FAMILIES.find(item => item.pattern.test(name)) || { base: 700, reasoning: 700, writing: 700, vision: 600 };
}

function clampScore(value) {
  return Math.max(100, Math.min(1200, Math.round(value)));
}

function scoreModel(modelName = '', extra = {}) {
  const normalized = normalizeModelName(modelName);
  const base = seededBase(normalized);
  const adjustment = versionBonus(normalized) + parameterBonus(normalized) + tierAdjustment(normalized);
  const isVisionHint = /vision|vl|omni|4o|gemini|claude|multimodal/i.test(normalized);
  const visionHintBonus = isVisionHint ? 25 : 0;

  return {
    model: String(modelName || ''),
    normalized,
    general_score: clampScore((base.base ?? 700) + adjustment + Number(extra.general_score || 0)),
    reasoning_score: clampScore((base.reasoning ?? base.base ?? 700) + adjustment + Number(extra.reasoning_score || 0)),
    writing_score: clampScore((base.writing ?? base.base ?? 700) + adjustment + Number(extra.writing_score || 0)),
    vision_score: clampScore((base.vision ?? 600) + adjustment + visionHintBonus + Number(extra.vision_score || 0)),
    freshness_score: clampScore(650 + versionBonus(normalized) * 4 + Number(extra.freshness_score || 0)),
    confidence: extra.confidence || (KNOWN_MODEL_OVERRIDES.some(item => item.pattern.test(normalized)) ? 'seeded' : 'inferred'),
  };
}

function capabilityScore(scores, capability = 'general') {
  if (capability === 'reasoning') return scores.reasoning_score;
  if (capability === 'writing') return scores.writing_score;
  if (capability === 'vision') return scores.vision_score;
  return scores.general_score;
}

function compareModels(a, b, capability = 'general') {
  return capabilityScore(scoreModel(a), capability) - capabilityScore(scoreModel(b), capability);
}

function modelVisionSupported(provider, model) {
  const marked = new Set(parseDelimitedList(provider.vision_models));
  if (marked.has(model)) return true;
  const results = provider.vision_check_results && typeof provider.vision_check_results === 'object'
    ? provider.vision_check_results
    : {};
  return results[model]?.supported === true;
}

function expandProviderModelCandidates(providers = [], options = {}) {
  const requireVision = !!options.requireVision;
  const capability = options.capability || (requireVision ? 'vision' : 'general');
  return providers
    .filter(provider => provider && provider.enabled !== false)
    .flatMap(provider => parseDelimitedList(provider.model).map(model => ({ provider, model })))
    .filter(candidate => !requireVision || modelVisionSupported(candidate.provider, candidate.model))
    .map(candidate => ({
      ...candidate,
      scores: scoreModel(candidate.model),
      capabilityScore: capabilityScore(scoreModel(candidate.model), capability),
    }))
    .sort((a, b) => b.capabilityScore - a.capabilityScore || b.scores.general_score - a.scores.general_score);
}

function selectReviewerModel(providers = [], context = {}) {
  const capability = context.capability || (context.requireVision ? 'vision' : 'reasoning');
  const candidates = expandProviderModelCandidates(providers, {
    requireVision: context.requireVision,
    capability,
  });
  if (candidates.length === 0) return null;

  const creatorModel = context.creatorModel || '';
  const creatorScore = creatorModel ? capabilityScore(scoreModel(creatorModel), capability) : -Infinity;
  const stronger = candidates.find(candidate => candidate.capabilityScore > creatorScore);
  const selected = stronger || candidates[0];
  return {
    provider: selected.provider,
    model: selected.model,
    scores: selected.scores,
    reason: stronger ? 'stronger_model' : 'same_level_fallback',
    creatorScore,
    reviewerScore: selected.capabilityScore,
  };
}

async function updateModelRankingsFromOpenRouter(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const url = options.url || DEFAULT_OPENROUTER_MODELS_URL;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs || 30000) });
  if (!response.ok) throw new Error(`OpenRouter models request failed (${response.status})`);
  const data = await response.json();
  const models = (Array.isArray(data?.data) ? data.data : [])
    .map(item => {
      const id = item.id || item.slug || item.name || '';
      return {
        id,
        name: item.name || id,
        scores: scoreModel(id || item.name),
        source: 'openrouter',
      };
    })
    .filter(item => item.id)
    .sort((a, b) => b.scores.general_score - a.scores.general_score);

  return {
    source: 'openrouter',
    updated_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' '),
    models,
  };
}

module.exports = {
  DEFAULT_OPENROUTER_MODELS_URL,
  scoreModel,
  compareModels,
  expandProviderModelCandidates,
  selectReviewerModel,
  updateModelRankingsFromOpenRouter,
};
