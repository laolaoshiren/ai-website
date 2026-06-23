/**
 * AI 站标生成器 - 自动生成与网站主题相关的 SVG favicon
 * 启动时检测，没有站标就自动调用 AI 生成
 */
const fs = require('fs');
const path = require('path');
const { callAIForJSON } = require('./client');

const FAVICON_SVG_PATH = path.join(__dirname, '..', 'public', 'favicon.svg');

/**
 * 检查站标是否存在
 */
function hasFavicon() {
  return fs.existsSync(FAVICON_SVG_PATH);
}

/**
 * 用 AI 生成 SVG 站标
 */
async function generateFavicon() {
  const { getSiteConfig, getSetting } = require('../config');
  const site = getSiteConfig();
  const title = site.title || getSetting('site_title') || 'AI';
  const theme = site.theme || getSetting('site_theme') || '科技';

  console.log('🎨 AI 正在生成站标...');

  const messages = [
    {
      role: 'system',
      content: `你是一个专业的 SVG 图标设计师。你需要为网站设计一个简洁、现代、有辨识度的 favicon（站标）。

要求：
1. 必须是纯 SVG 代码，viewBox="0 0 512 512"
2. 设计简洁大方，缩小到 16x16 也能辨认
3. 颜色鲜明，适合深色和浅色背景
4. 与网站主题相关，能体现网站的核心内容
5. 不要使用文字（缩小后看不清），用图形/符号表达
6. 可以使用渐变、几何形状等现代设计元素

你必须返回 JSON 格式。`
    },
    {
      role: 'user',
      content: `请为以下网站设计 favicon：

网站名称：${title}
网站主题：${theme}

请返回 JSON 格式：
{
  "svg": "完整的 SVG 代码（不含 xml 声明，不含外层 html 标签）",
  "description": "站标设计说明"
}`
    }
  ];

  try {
    const { data } = await callAIForJSON(messages, {
      taskType: 'generate_favicon',
      maxTokens: 2048,
      temperature: 0.8,
    });

    let svg = data.svg || '';
    // 清理 SVG：去掉 xml 声明，确保有 viewBox
    svg = svg.replace(/<\?xml[^?]*\?>/g, '').trim();
    if (!svg.includes('viewBox')) {
      svg = svg.replace('<svg', '<svg viewBox="0 0 512 512"');
    }

    if (!svg.startsWith('<svg')) {
      throw new Error('AI 返回的 SVG 格式不正确');
    }

    // 确保 public 目录存在
    const publicDir = path.dirname(FAVICON_SVG_PATH);
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

    fs.writeFileSync(FAVICON_SVG_PATH, svg, 'utf8');
    console.log(`✅ 站标已生成: ${FAVICON_SVG_PATH}`);
    if (data.description) console.log(`   设计说明: ${data.description}`);
    return true;
  } catch (err) {
    console.error('❌ 站标生成失败:', err.message);
    // 生成一个默认的 fallback SVG
    generateFallbackFavicon(title);
    return false;
  }
}

/**
 * 生成默认 fallback 站标
 */
function generateFallbackFavicon(title) {
  const initial = (title || 'AI').charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <text x="256" y="340" font-family="Arial,sans-serif" font-size="300" font-weight="bold" fill="white" text-anchor="middle">${initial}</text>
</svg>`;

  const publicDir = path.dirname(FAVICON_SVG_PATH);
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(FAVICON_SVG_PATH, svg, 'utf8');
  console.log('✅ 已生成默认站标（fallback）');
}

/**
 * 启动时自动检测并生成站标
 */
async function ensureFavicon() {
  if (!hasFavicon()) {
    console.log('🖼️  未检测到站标，自动生成...');
    await generateFavicon();
  }
}

module.exports = { hasFavicon, generateFavicon, ensureFavicon };
