/**
 * AI 通用客户端 v3 - 多提供商、负载均衡、故障自动恢复
 */
const { getActiveAIProvider, incrementProviderUsage, getAIProviders } = require('../db/database');
const { executeTool, getToolDefinitions } = require('./tools');

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
      const providers = getAIProviders().filter(p => p.enabled);
      if (providers.length === 0) return;

      // 用最轻量的请求探测 provider 是否恢复
      const provider = providers[0];
      const url = `${provider.base_url.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.api_key}` },
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
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
  const providers = getAIProviders().filter(p => p.enabled);
  if (providers.length === 0) throw new Error('没有可用的 AI 提供商，请在后台添加');

  providers.sort((a, b) => (a.request_count || 0) - (b.request_count || 0));

  let lastError = null;
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callProvider(provider, messages, options);
        incrementProviderUsage(provider.id, true);
        // 如果之前在故障状态，成功后停止恢复轮询
        if (outageState.active) stopRecovery();
        return result;
      } catch (err) {
        incrementProviderUsage(provider.id, false);
        lastError = err;
        const retryable = err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') ||
          err.message.includes('fetch failed') || err.message.includes('503') || err.message.includes('429') ||
          err.message.includes('502') || err.message.includes('500');
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
  const url = `${provider.base_url.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: options.model || provider.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };
  if (options.useTools) body.tools = getToolDefinitions();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.api_key}` },
    body: JSON.stringify(body),
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

  return { content, model: data.model, tokensUsed, provider: provider.name, providerId: provider.id, toolCalls };
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
    return { ...result, data: parseJSON(result.content) };
  } catch (err) {
    if (err.message.includes('response_format') || err.message.includes('json_object')) {
      const result = await callAI(messages, { ...options, jsonMode: false });
      return { ...result, data: parseJSON(result.content) };
    }
    throw err;
  }
}

function parseJSON(text) {
  if (!text) throw new Error('AI 返回内容为空');
  try { return JSON.parse(text); } catch {}
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[1].trim()); } catch {} }
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) { try { return JSON.parse(objectMatch[0]); } catch {} }
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) { try { return JSON.parse(arrayMatch[0]); } catch {} }
  throw new Error('无法从 AI 响应中解析 JSON');
}

/**
 * 测试连接
 */
async function testConnection(provider) {
  try {
    const url = `${provider.base_url.replace(/\/+$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.api_key}` },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: '回复"连接成功"' }], max_tokens: 50 }),
    });
    if (!response.ok) { const t = await response.text(); return { success: false, error: `HTTP ${response.status}: ${t.slice(0, 200)}` }; }
    const data = await response.json();
    return { success: true, model: data.model, message: data.choices?.[0]?.message?.content?.trim() || '连接成功' };
  } catch (err) { return { success: false, error: err.message }; }
}

module.exports = { callAI, callAIWithTools, callAIForJSON, parseJSON, testConnection, getOutageStatus, setRecoveryCallback };
