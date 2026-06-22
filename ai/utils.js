/**
 * AI 工具函数
 */

function slugify(text) {
  if (!text) return '';
  // 中文标题生成简单的英文 slug
  const pinyin = text
    .replace(/[^一-龥a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .slice(0, 80);

  // 如果全是中文，用时间戳 + 简短哈希
  if (/^[一-龥-]+$/.test(pinyin) || !pinyin) {
    const hash = require('crypto').createHash('md5').update(text).digest('hex').slice(0, 8);
    const ts = Date.now().toString(36);
    return `p-${ts}-${hash}`;
  }
  return pinyin;
}

function createDOMPurify() {
  const { JSDOM } = require('jsdom');
  const createDOMPurify = require('dompurify');
  const window = new JSDOM('').window;
  return createDOMPurify(window);
}

module.exports = { slugify, createDOMPurify };
