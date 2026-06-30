/**
 * AI 通用客户端 v3 - 多提供商、负载均衡、故障自动恢复
 */
const { getActiveAIProvider, incrementProviderUsage, getAIProviders, updateAIProvider } = require('../db/database');
const { executeTool, getToolDefinitions } = require('./tools');
const { shouldUseMoA, runMoA } = require('./moa');
const { selectReviewerModel } = require('./model-intelligence');

const DEFAULT_AI_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_VISION_CAPABILITY_TTL_MS = 6 * 60 * 60 * 1000;
const REVIEW_TASKS = new Set(['style_review', 'content_review', 'image_review', 'quality_review', 'template_review']);

function timestamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
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

function parseAIProviderKeys(value) {
  return parseDelimitedList(value);
}

function parseAIProviderModels(value) {
  return parseDelimitedList(value);
}

function classifyProviderError(err) {
  const message = String(err?.message || err || '');
  if (/(?:401|403|invalid api key|invalid key|unauthorized|forbidden|api[_ -]?key)/i.test(message)) return 'auth';
  if (/(?:429|rate limit|too many requests|quota)/i.test(message)) return 'rate_limit';
  if (/(?:ECONNRESET|ETIMEDOUT|fetch failed|network|timeout|请求超时)/i.test(message)) return 'network';
  if (/(?:500|502|503|504|server error|bad gateway|service unavailable)/i.test(message)) return 'server';
  return 'unknown';
}

function providerHealthPenalty(provider) {
  const requestCount = provider.request_count || 0;
  const errorCount = provider.error_count || 0;
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
  let penalty = requestCount + errorCount * 10;
  if (requestCount >= 10 && errorRate >= 0.75) penalty += 100000;
  else if (requestCount >= 10 && errorRate >= 0.5) penalty += 50000;
  else if (requestCount >= 10 && errorRate >= 0.25) penalty += 10000;
  if (provider.disabled_reason === 'auth_error') penalty += 200000;
  return penalty;
}

function rankAIProviders(providers = []) {
  return providers
    .slice()
    .sort((a, b) => providerHealthPenalty(a) - providerHealthPenalty(b) || (a.request_count || 0) - (b.request_count || 0) || (a.id || 0) - (b.id || 0));
}

function routeReviewProviders(providers = [], options = {}) {
  const isReviewTask = REVIEW_TASKS.has(options.taskType) || !!options.preferReviewerOverModel;
  if (!isReviewTask) return { providers, routing: null };

  const selected = selectReviewerModel(providers, {
    creatorModel: options.preferReviewerOverModel || '',
    capability: options.reviewCapability || (options.requireVision ? 'vision' : 'reasoning'),
    requireVision: options.requireVision,
  });
  if (!selected) return { providers, routing: null };

  return {
    providers: [{ ...selected.provider, model: selected.model }],
    routing: selected,
  };
}

function chooseProviderCredential(provider, options = {}) {
  const keys = parseAIProviderKeys(provider.api_key);
  const models = parseAIProviderModels(provider.model);
  const pick = (items, fallback) => {
    if (items.length === 0) return fallback;
    if (options.first) return items[0];
    return items[Math.floor(Math.random() * items.length)];
  };
  return {
    apiKey: pick(keys, provider.api_key),
    model: options.model || pick(models, provider.model),
  };
}

function buildVisionProbeMessages() {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Look at the attached single-color image. Reply only JSON: {"vision":true,"color":"dominant color name"}. If you cannot inspect images, reply {"vision":false,"color":"unknown"}.',
        },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lw9pKAAAAABJRU5ErkJggg==',
          },
        },
      ],
    },
  ];
}

function isVisionProbeSuccess(content) {
  const text = String(content || '').trim();
  const lower = text.toLowerCase();
  if (/(cannot|can't|unable|no image|not able|do not have|don't have|as an ai text|无法|不能|看不到|无法查看|不能查看)/i.test(text)) {
    return false;
  }

  const parsed = tryParseJsonCandidate(text);
  if (parsed && typeof parsed === 'object') {
    const vision = parsed.vision === true || parsed.supports_vision === true || parsed.can_see_image === true;
    const color = String(parsed.color || parsed.answer || parsed.result || '').toLowerCase();
    return vision && /red|#f00|ff0000|红/.test(color);
  }

  return /red|#f00|ff0000|红/.test(lower);
}

async function testProviderVisionCapabilities(provider, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const keys = parseAIProviderKeys(provider.api_key);
  const models = parseAIProviderModels(provider.model);
  const checkedAt = timestamp();
  const results = {};
  const visionModels = [];

  if (keys.length === 0) {
    return { checkedAt, visionModels, results, error: 'missing_api_key' };
  }

  for (const model of models) {
    let lastError = null;
    try {
      for (const apiKey of keys) {
        const response = await fetchImpl(`${provider.base_url.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: buildVisionProbeMessages(),
            temperature: 0,
            max_tokens: 80,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText.slice(0, 160)}`;
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const supported = isVisionProbeSuccess(content);
        results[model] = {
          supported,
          checked_at: checkedAt,
          response: String(content || '').slice(0, 160),
        };
        if (supported) visionModels.push(model);
        lastError = null;
        break;
      }

      if (!results[model]) {
        results[model] = { supported: false, checked_at: checkedAt, error: String(lastError || 'vision_probe_failed').slice(0, 180) };
      }
    } catch (err) {
      results[model] = { supported: false, checked_at: checkedAt, error: String(err?.message || err || '').slice(0, 180) };
    }
  }

  return { checkedAt, visionModels, results };
}

function markProviderVisionCapabilities(provider, capability = {}) {
  if (!provider?.id) return;
  try {
    updateAIProvider(provider.id, {
      vision_models: (capability.visionModels || []).join(','),
      vision_check_results: capability.results || {},
      vision_checked_at: capability.checkedAt || timestamp(),
    });
  } catch {}
}

function modelVisionSupported(provider, model) {
  const currentModels = new Set(parseAIProviderModels(provider.model));
  if (!currentModels.has(model)) return false;
  const marked = new Set(parseAIProviderModels(provider.vision_models));
  if (marked.has(model)) return true;
  const results = provider.vision_check_results && typeof provider.vision_check_results === 'object'
    ? provider.vision_check_results
    : {};
  return results[model]?.supported === true;
}

function visionCapableProviderCandidates(providers = []) {
  return providers
    .filter(provider => provider.enabled !== false)
    .map(provider => {
      const visionModels = parseAIProviderModels(provider.model).filter(model => modelVisionSupported(provider, model));
      if (visionModels.length === 0) return null;
      return { ...provider, model: visionModels.join(',') };
    })
    .filter(Boolean);
}

function needsVisionCapabilityRefresh(provider, options = {}) {
  if (options.forceVisionCheck) return true;
  const models = parseAIProviderModels(provider.model);
  if (models.length === 0) return false;
  const results = provider.vision_check_results && typeof provider.vision_check_results === 'object'
    ? provider.vision_check_results
    : {};
  if (models.some(model => !results[model])) return true;

  const checkedAt = Date.parse(String(provider.vision_checked_at || '').replace(' ', 'T'));
  if (!Number.isFinite(checkedAt)) return true;
  const ttlMs = options.visionCapabilityTtlMs ?? DEFAULT_VISION_CAPABILITY_TTL_MS;
  return Date.now() - checkedAt > ttlMs;
}

async function ensureVisionProviderCapabilities(providers = [], options = {}) {
  for (const provider of providers) {
    if (!provider.enabled || !needsVisionCapabilityRefresh(provider, options)) continue;
    const capability = await testProviderVisionCapabilities(provider, options);
    markProviderVisionCapabilities(provider, capability);
    provider.vision_models = capability.visionModels.join(',');
    provider.vision_check_results = capability.results;
    provider.vision_checked_at = capability.checkedAt;
  }
}

function markProviderFailure(provider, err) {
  const errorType = classifyProviderError(err);
  const updates = {
    last_error: String(err?.message || err || '').slice(0, 500),
    last_error_type: errorType,
    last_error_at: timestamp(),
  };
  if (errorType === 'auth') {
    updates.enabled = false;
    updates.disabled_reason = 'auth_error';
  }
  try { updateAIProvider(provider.id, updates); } catch {}
  return errorType;
}

function markProviderSuccess(provider, result = {}) {
  try {
    updateAIProvider(provider.id, {
      last_success_at: timestamp(),
      last_error_type: null,
      last_error: null,
      disabled_reason: provider.disabled_reason === 'auth_error' ? provider.disabled_reason : null,
      last_model: result.model || '',
    });
  } catch {}
}

// ============ 故障恢复系统 ============
const outageState = {
  active: false,        // 是否处于故障状态
  startedAt: null,      // 故障开始时间
  lastCheck: null,      // 上次检查时间
  checkInterval: null,  // 定时器句柄
  failCount: 0,         // 连续失败次数
  onRecover: null,      // 恢复回调
};

const CHECK_INTERVAL = 3 * 60 * 1000; // 每 3 分钟检查一次

/**
 * 启动故障恢复轮询
 */
function startRecovery() {
  if (outageState.checkInterval) return; // 已经在轮询

  outageState.active = true;
  outageState.startedAt = outageState.startedAt || new Date().toISOString();
  console.log(`🚨 AI 提供商全部故障，启动自动恢复轮询（每 ${CHECK_INTERVAL / 1000}s 检查一次）`);

  outageState.checkInterval = setInterval(async () => {
    outageState.lastCheck = new Date().toISOString();
    try {
      const providers = rankAIProviders(getAIProviders().filter(p => p.enabled));
      if (providers.length === 0) return;

      // 用最轻量的请求探测 provider 是否恢复
      const provider = providers[0];
      const { apiKey, model } = chooseProviderCredential(provider, { first: true });
      const url = `${provider.base_url.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        // 恢复了！
        const duration = Math.round((Date.now() - new Date(outageState.startedAt).getTime()) / 60000);
        console.log(`✅ AI 提供商已恢复！故障持续 ${duration} 分钟`);
        stopRecovery();

        // 触发补偿任务
        if (outageState.onRecover) {
          console.log('🔄 触发故障恢复补偿任务...');
          try { await outageState.onRecover(); } catch (e) { console.error('补偿任务失败:', e.message); }
        }
      } else {
        outageState.failCount++;
        console.log(`⏳ AI 提供商仍不可用 (${response.status})，已检测 ${outageState.failCount} 次`);
      }
    } catch (err) {
      outageState.failCount++;
      console.log(`⏳ AI 提供商仍不可用 (${err.message})，已检测 ${outageState.failCount} 次`);
    }
  }, CHECK_INTERVAL);
}

/**
 * 停止故障恢复轮询
 */
function stopRecovery() {
  if (outageState.checkInterval) {
    clearInterval(outageState.checkInterval);
    outageState.checkInterval = null;
  }
  outageState.active = false;
  outageState.failCount = 0;
  outageState.startedAt = null;
}

/**
 * 获取故障恢复状态
 */
function getOutageStatus() {
  return {
    active: outageState.active,
    startedAt: outageState.startedAt,
    lastCheck: outageState.lastCheck,
    failCount: outageState.failCount,
    durationMinutes: outageState.startedAt ? Math.round((Date.now() - new Date(outageState.startedAt).getTime()) / 60000) : 0,
  };
}

/**
 * 设置恢复回调（scheduler 注册）
 */
function setRecoveryCallback(fn) {
  outageState.onRecover = fn;
}

// ============ 核心调用 ============

/**
 * 调用 AI API（自动选择提供商、故障转移、自动重试、故障恢复）
 */
async function callAI(messages, options = {}) {
  let providers = rankAIProviders(getAIProviders().filter(p => p.enabled));
  if (options.requireVision) {
    await ensureVisionProviderCapabilities(providers, options);
    providers = rankAIProviders(visionCapableProviderCandidates(providers));
    if (providers.length === 0) throw new Error('没有可用的多模态文字 AI 模型，无法执行图片审核');
  }
  if (providers.length === 0) throw new Error('没有可用的 AI 提供商，请在后台添加');

  const reviewRoute = routeReviewProviders(providers, options);
  providers = reviewRoute.providers;

  let moaFallbackError = null;
  try {
    const config = require('../config').getConfig();
    if (!reviewRoute.routing && !options.requireVision && shouldUseMoA(options, config)) {
      return await runMoA(messages, options, {
        getProviders: () => getAIProviders().filter(p => p.enabled),
        rankProviders: rankAIProviders,
        callProvider,
        onSuccess: (provider, result) => {
          incrementProviderUsage(provider.id, true);
          markProviderSuccess(provider, result);
        },
        onFailure: (provider, err) => {
          incrementProviderUsage(provider.id, false);
          markProviderFailure(provider, err);
        },
      });
    }
  } catch (err) {
    moaFallbackError = err;
    console.log('MoA 模式降级为单模型:', err.message);
  }

  let lastError = null;
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callProvider(provider, messages, options);
        incrementProviderUsage(provider.id, true);
        markProviderSuccess(provider, result);
        // 如果之前在故障状态，成功后停止恢复轮询
        if (outageState.active) stopRecovery();
        const routedResult = reviewRoute.routing ? { ...result, reviewRouting: reviewRoute.routing } : result;
        return moaFallbackError ? applyMoAFallbackMarker(routedResult, moaFallbackError) : routedResult;
      } catch (err) {
        incrementProviderUsage(provider.id, false);
        const errorType = markProviderFailure(provider, err);
        lastError = err;
        const retryable = errorType === 'network' || errorType === 'rate_limit' || errorType === 'server';
        if (attempt === 0 && retryable) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        break;
      }
    }
  }

  // 所有 provider 都失败 → 启动故障恢复
  if (!outageState.active) startRecovery();

  throw new Error(`所有 AI 提供商均失败，最后错误: ${lastError?.message}`);
}

async function callProvider(provider, messages, options = {}) {
  // 多密钥/多模型：逗号分隔，随机选择实现负载均衡
  const { apiKey, model } = chooseProviderCredential(provider, options);

  const url = `${provider.base_url.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };
  if (options.useTools) body.tools = getToolDefinitions();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg;
    try { errorMsg = JSON.parse(errorText).error?.message || errorText; } catch { errorMsg = errorText; }
    throw new Error(`API 错误 (${response.status}): ${errorMsg}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const tokensUsed = data.usage?.total_tokens || 0;
  const toolCalls = data.choices?.[0]?.message?.tool_calls || null;

  return { content, model: data.model || model, tokensUsed, provider: provider.name, providerId: provider.id, toolCalls };
}

function applyMoAFallbackMarker(result = {}, err) {
  return {
    ...result,
    moaFallback: true,
    moaError: String(err?.message || err || ''),
  };
}

/**
 * 带工具调用的 AI 对话（自动执行工具并循环）
 */
async function callAIWithTools(messages, options = {}, maxRounds = 3) {
  const allMessages = [...messages];
  let totalTokens = 0;
  let provider = '';

  for (let round = 0; round < maxRounds; round++) {
    const result = await callAI(allMessages, { ...options, useTools: true });
    totalTokens += result.tokensUsed;
    provider = result.provider;

    // 如果没有工具调用，直接返回
    if (!result.toolCalls || result.toolCalls.length === 0) {
      return { content: result.content, tokensUsed: totalTokens, provider, rounds: round + 1 };
    }

    // 执行工具调用
    allMessages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });

    for (const toolCall of result.toolCalls) {
      const fnName = toolCall.function.name;
      let args;
      try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

      console.log(`  🔧 调用工具: ${fnName}(${JSON.stringify(args).slice(0, 60)})`);
      let toolResult;
      try {
        toolResult = await executeTool(fnName, args);
      } catch (e) {
        toolResult = { error: e.message };
      }

      allMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult).slice(0, 4000),
      });
    }
  }

  // 最后一轮不带工具
  const finalResult = await callAI(allMessages, { ...options, useTools: false });
  return { content: finalResult.content, tokensUsed: totalTokens + finalResult.tokensUsed, provider, rounds: maxRounds };
}

/**
 * 调用 AI 并解析 JSON 响应
 */
async function callAIForJSON(messages, options = {}) {
  try {
    const result = await callAI(messages, { ...options, jsonMode: true });
    try {
      return { ...result, data: parseJSON(result.content) };
    } catch (parseErr) {
      if (shouldFallbackFromMoAParseError(result, parseErr)) {
        const fallback = await callAI(messages, { ...options, jsonMode: true, moa: false });
        return { ...fallback, data: parseJSON(fallback.content), moaFallback: true, moaError: parseErr.message };
      }
      throw parseErr;
    }
  } catch (err) {
    if (err.message.includes('response_format') || err.message.includes('json_object')) {
      const result = await callAI(messages, { ...options, jsonMode: false });
      return { ...result, data: parseJSON(result.content) };
    }
    throw err;
  }
}

function shouldFallbackFromMoAParseError(result, err) {
  return !!result?.moa && /JSON|解析|parse|empty|为空/i.test(String(err?.message || err || ''));
}

function repairJsonText(text) {
  return String(text || '')
    .trim()
    .replace(/,\s*([}\]])/g, '$1');
}

function tryParseJsonCandidate(candidate) {
  const trimmed = String(candidate || '').trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  try { return JSON.parse(repairJsonText(trimmed)); } catch {}
  return null;
}

function fencedJsonCandidates(text) {
  const candidates = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fencePattern.exec(text))) {
    candidates.push(match[1]);
  }
  return candidates;
}

function balancedJsonCandidates(text, openChar, closeChar) {
  const source = String(text || '');
  const candidates = [];

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== openChar) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          candidates.push(source.slice(start, index + 1));
          break;
        }
      }
    }
  }

  return candidates;
}

function parseJSON(text) {
  if (!String(text || '').trim()) throw new Error('AI 返回内容为空');
  const candidates = [
    text,
    ...fencedJsonCandidates(text),
    ...balancedJsonCandidates(text, '{', '}'),
    ...balancedJsonCandidates(text, '[', ']'),
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    const key = String(candidate || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed !== null) return parsed;
  }

  throw new Error('无法从 AI 响应中解析 JSON');
}

/**
 * 测试连接
 */
async function testConnection(provider) {
  try {
    const { apiKey, model } = chooseProviderCredential(provider, { first: true });
    const url = `${provider.base_url.replace(/\/+$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '回复"连接成功"' }], max_tokens: 50 }),
    });
    if (!response.ok) { const t = await response.text(); return { success: false, error: `HTTP ${response.status}: ${t.slice(0, 200)}` }; }
    const data = await response.json();
    const vision = await testProviderVisionCapabilities(provider);
    markProviderVisionCapabilities(provider, vision);
    const visionMessage = vision.visionModels.length > 0
      ? `；视觉审核模型 ${vision.visionModels.length}/${parseAIProviderModels(provider.model).length} 个可用：${vision.visionModels.join(', ')}`
      : `；未检测到可用于图片审核的多模态模型`;
    return { success: true, model: data.model, message: `${data.choices?.[0]?.message?.content?.trim() || '连接成功'}${visionMessage}`, vision };
  } catch (err) { return { success: false, error: err.message }; }
}

module.exports = { callAI, callAIWithTools, callAIForJSON, parseJSON, testConnection, getOutageStatus, setRecoveryCallback, DEFAULT_AI_TIMEOUT_MS, DEFAULT_VISION_CAPABILITY_TTL_MS, rankAIProviders, routeReviewProviders, classifyProviderError, chooseProviderCredential, parseAIProviderKeys, parseAIProviderModels, testProviderVisionCapabilities, visionCapableProviderCandidates, ensureVisionProviderCapabilities, shouldFallbackFromMoAParseError, applyMoAFallbackMarker };
