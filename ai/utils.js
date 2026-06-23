/**
 * AI 工具函数
 */

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function slugify(text) {
  if (!text) return '';
  // 中文标题生成简单的英文 slug
  const pinyin = text
    .replace(/[^一-龥a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .slice(0, 80);

  // 如果没有生成有效 slug（全是中文或特殊字符），用确定性 hash
  if (/^[一-龥-]+$/.test(pinyin) || !pinyin) {
    return 'p-' + hashStr(text);
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
