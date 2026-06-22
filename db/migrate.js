/**
 * 从旧服务器自动迁移网站设置到新数据库
 */
const { addAIProvider, setSetting, getAIProviders } = require('./database');

async function migrateFromOldServer(oldServerUrl = 'http://localhost:3000') {
  try {
    const healthRes = await fetch(`${oldServerUrl}/api/health`);
    if (!healthRes.ok) return false;
    console.log('✅ 检测到旧服务器，自动迁移设置...');

    const settingsRes = await fetch(`${oldServerUrl}/admin/settings`);
    const html = await settingsRes.text();

    const extractValue = (name) => {
      const regex = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
      const match = html.match(regex);
      return match ? match[1] : null;
    };

    const siteTitle = extractValue('site_title');
    const siteTheme = extractValue('site_theme');
    const siteUrl = extractValue('site_url');

    if (siteTitle) setSetting('site_title', siteTitle);
    if (siteTheme) setSetting('site_theme', siteTheme);
    if (siteUrl) setSetting('site_url', siteUrl);

    console.log('✅ 网站设置已迁移');
    return true;
  } catch (err) {
    console.log('迁移跳过:', err.message);
    return false;
  }
}

module.exports = { migrateFromOldServer };
