/**
 * AI 通用客户端 v2 - 多提供商支持、负载均衡、自动故障转移
 */
const { getActiveAIProvider, incrementProviderUsage, getAIProviders } = require('../db/database');

/**
 * 调用 AI API（自动选择提供商、故障转移）
 */
async function callAI(messages, options = {}) {
  const providers = getAIProviders().filter(p => p.enabled);
  if (providers.length === 0) throw new Error('没有可用的 AI 提供商，请在后台添加');

  // 轮询：选最少使用的
  providers.sort((a, b) => (a.request_count || 0) - (b.request_count || 0));

  let lastError = null;
  for (const provider of providers) {
    try {
      const result = await callProvider(provider, messages, options);
      incrementProviderUsage(provider.id, true);
      return result;
    } catch (err) {
      incrementProviderUsage(provider.id, false);
      lastError = err;
      console.log(`  ⚠️ 提供商 ${provider.name} 失败: ${err.message}，尝试下一个...`);
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

  return { content, model: data.model, tokensUsed, provider: provider.name, providerId: provider.id };
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

module.exports = { callAI, callAIForJSON, parseJSON, testConnection };
