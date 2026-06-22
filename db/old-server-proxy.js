/**
 * 旧服务器代理 - 通过旧服务器的 AI 配置执行请求
 * 在新服务器没有配置提供商时自动使用
 */
const { addAIProvider, getAIProviders, setSetting } = require('./database');

let oldServerUrl = null;
let oldServerAvailable = false;

async function checkOldServer(url = 'http://localhost:3000') {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      oldServerUrl = url;
      oldServerAvailable = true;
      return true;
    }
  } catch {}
  oldServerAvailable = false;
  return false;
}

async function tryMigrateProviders() {
  if (!oldServerAvailable) return;
  if (getAIProviders().length > 0) return;

  // 尝试通过旧服务器的设置页面获取 AI 配置
  try {
    const res = await fetch(`${oldServerUrl}/admin/settings`);
    const html = await res.text();

    // 提取 textarea 中的 AI 配置（旧 v1 模板格式）
    const extractTextarea = (name) => {
      const regex = new RegExp(`name="${name}"[^>]*>\\s*([^<]*)\\s*</textarea>`, 'i');
      const match = html.match(regex);
      return match ? match[1].trim() : null;
    };

    const extractInput = (name) => {
      const regex = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
      const match = html.match(regex);
      return match ? match[1] : null;
    };

    const baseUrl = extractInput('ai_base_url') || extractTextarea('ai_base_url');
    const apiKey = extractInput('ai_api_key') || extractTextarea('ai_api_key');
    const model = extractInput('ai_model') || extractTextarea('ai_model');

    if (apiKey && baseUrl && model) {
      addAIProvider({ name: '自动迁移', base_url: baseUrl, api_key: apiKey, model });
      console.log(`✅ 自动迁移提供商: ${model}`);
      return;
    }

    // 迁移网站设置
    const siteTitle = extractInput('site_title');
    const siteTheme = extractInput('site_theme');
    if (siteTitle) setSetting('site_title', siteTitle);
    if (siteTheme) setSetting('site_theme', siteTheme);
  } catch {}
}

// 通过旧服务器的 /api/health 检查 AI 是否可用
async function isOldServerAIReady() {
  if (!oldServerAvailable) return false;
  try {
    const res = await fetch(`${oldServerUrl}/api/health`);
    const data = await res.json();
    return data.stats?.totalArticles > 0 || data.stats?.totalTasks > 0;
  } catch { return false; }
}

module.exports = { checkOldServer, tryMigrateProviders, isOldServerAIReady, getOldServerUrl: () => oldServerUrl };
