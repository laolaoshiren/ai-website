const { slugify } = require('./utils');

const CATEGORY_NAME_MAX_LENGTH = 32;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 120;
const CATEGORY_SLUG_MAX_LENGTH = 80;

function isSentenceLikeCategoryName(name) {
  const text = String(name || '').trim();
  if (!text) return false;
  const looksLikeSuggestion = /建议|应该|专门|用于|以填补|当前|内容空白|变更说明/.test(text);
  const hasSentencePunctuation = /[，。；：！？、]/.test(text);
  return text.length > 18 && (looksLikeSuggestion || hasSentencePunctuation);
}

function normalizeSlug(value, fallbackName) {
  const raw = String(value || '').trim();
  const source = raw || fallbackName;
  let slug = raw
    ? raw.toLowerCase().replace(/\s+/g, '-')
    : slugify(source);

  slug = slug
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, CATEGORY_SLUG_MAX_LENGTH);

  if (!slug && fallbackName) slug = slugify(fallbackName);
  return slug;
}

function validateCategoryInput(input, options = {}) {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('请输入栏目名称');
  if (isSentenceLikeCategoryName(name)) throw new Error('栏目名称不能是一整句建议');
  if (name.length > CATEGORY_NAME_MAX_LENGTH) throw new Error(`栏目名称不能超过 ${CATEGORY_NAME_MAX_LENGTH} 个字符`);

  const slug = normalizeSlug(input?.slug, name);
  if (!slug) throw new Error('URL标识不能为空');
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('URL标识只能包含小写字母、数字和连字符');

  const description = String(input?.description || '').trim();
  if (description.length > CATEGORY_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`栏目简介不能超过 ${CATEGORY_DESCRIPTION_MAX_LENGTH} 个字符`);
  }

  const existingCategories = options.existingCategories || [];
  const currentId = options.currentId ? Number(options.currentId) : null;
  const duplicateSlug = existingCategories.find((cat) => cat.slug === slug && Number(cat.id) !== currentId);
  if (duplicateSlug) throw new Error(`URL标识已存在: ${slug}`);
  const duplicateName = existingCategories.find((cat) => String(cat.name).trim() === name && Number(cat.id) !== currentId);
  if (duplicateName) throw new Error(`栏目名称已存在: ${name}`);

  return {
    name,
    slug,
    description,
    sort_order: parseInt(input?.sort_order, 10) || 0,
  };
}

function selectCategoriesForPlanning(existingCategories, plannedCategories, options = {}) {
  const currentCategories = Array.isArray(existingCategories) ? existingCategories : [];
  const isColdStart = options.isColdStart === true && currentCategories.length === 0;
  if (!isColdStart || !Array.isArray(plannedCategories)) return [];

  const accepted = [];
  const seenNames = new Set();
  const seenSlugs = new Set();

  for (const draft of plannedCategories) {
    if (accepted.length >= 6) break;
    try {
      const category = validateCategoryInput(draft);
      const nameKey = category.name.toLowerCase();
      if (seenNames.has(nameKey) || seenSlugs.has(category.slug)) continue;
      accepted.push(category);
      seenNames.add(nameKey);
      seenSlugs.add(category.slug);
    } catch (err) {
      continue;
    }
  }

  return accepted;
}

module.exports = {
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_SLUG_MAX_LENGTH,
  isSentenceLikeCategoryName,
  normalizeSlug,
  validateCategoryInput,
  selectCategoriesForPlanning,
};
