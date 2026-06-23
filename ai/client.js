/**
 * AI 通用客户端 v2 - 多提供商支持、负载均衡、工具调用
 */
const { getActiveAIProvider, incrementProviderUsage, getAIProviders } = require('../db/database');
const { executeTool, getToolDefinitions } = require('./tools');

/**
 * 调用 AI API（自动选择提供商、故障转移、自动重试）
 */
async function callAI(messages, options = {}) {
  const providers = getAIProviders().filter(p => p.enabled);
  if (providers.length === 0) throw new Error('没有可用的 AI 提供商，请在后台添加');

  providers.sort((a, b) => (a.request_count || 0) - (b.request_count || 0));

  let lastError = null;
  for (const provider of providers) {
    // 每个 provider 最多重试 2 次
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callProvider(provider, messages, options);
        incrementProviderUsage(provider.id, true);
        return result;
      } catch (err) {
        incrementProviderUsage(provider.id, false);
        lastError = err;
        const retryable = err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') ||
          err.message.includes('fetch failed') || err.message.includes('503') || err.message.includes('429') ||
          err.message.includes('502') || err.message.includes('500');
        if (attempt === 0 && retryable) {
          const delay = 1000 * (attempt + 1);
          console.log(`  ⚠️ 提供商 ${provider.name} 失败: ${err.message}，${delay}ms 后重试...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.log(`  ⚠️ 提供商 ${provider.name} 失败: ${err.message}，跳过`);
        break;
      }
    }
  }
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

module.exports = { callAI, callAIWithTools, callAIForJSON, parseJSON, testConnection };
