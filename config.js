/**
 * 配置管理 v2 - 适配多提供商数据库
 */
const { getAllSettings, getSetting, setSetting, getActiveAIProvider } = require('./db/database');

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 5000;

function getConfig() {
  const now = Date.now();
  if (!cachedConfig || (now - cacheTime) > CACHE_TTL) {
    cachedConfig = getAllSettings();
    cacheTime = now;
  }
  return cachedConfig;
}

function refreshConfig() { cachedConfig = null; return getConfig(); }

function getSiteConfig() {
  const config = getConfig();
  return {
    title: config.site_title || 'AI 智能网站',
    description: config.site_description || '',
    theme: config.site_theme || '',
    direction: config.site_direction || '',
    language: config.site_language || 'zh-CN',
    url: config.site_url || 'http://localhost:3000',
    loopEnabled: config.ai_loop_enabled === '1',
  };
}

function isAIConfigured() {
  const provider = getActiveAIProvider();
  return !!(provider && provider.api_key && provider.base_url && provider.model);
}

module.exports = { getConfig, refreshConfig, getSiteConfig, isAIConfigured, getSetting, setSetting };
