const test = require('node:test');
const assert = require('node:assert/strict');

const { getPlannerPrompt, getAnalyzerPrompt } = require('../ai/prompts');
const {
  selectCategoriesForPlanning,
  validateCategoryInput,
} = require('../ai/category-policy');
const { initDb } = require('../db/database');

test.before(async () => {
  await initDb();
});

test('planner rejects all AI category changes after categories exist', () => {
  const existingCategories = [
    { id: 1, name: '前沿研究', slug: 'frontier-research' },
    { id: 2, name: '产业动态', slug: 'industry-news' },
  ];
  const plannedCategories = [
    { name: 'AI 工具箱', slug: 'ai-toolbox', description: '新增工具教程', sort_order: 3 },
    { name: '前沿洞察', slug: 'frontier-research', description: '试图重命名', sort_order: 1 },
  ];

  const accepted = selectCategoriesForPlanning(existingCategories, plannedCategories, { isColdStart: false });

  assert.deepEqual(accepted, []);
});

test('planner accepts initial category structure only during cold start', () => {
  const plannedCategories = [
    { name: '前沿研究', slug: 'frontier-research', description: '模型和算法进展', sort_order: 1 },
    { name: '产业动态', slug: 'industry-news', description: '融资与产品发布', sort_order: 2 },
  ];

  const accepted = selectCategoriesForPlanning([], plannedCategories, { isColdStart: true });

  assert.equal(accepted.length, 2);
  assert.equal(accepted[0].slug, 'frontier-research');
});

test('category validation rejects sentence-like AI suggestions', () => {
  assert.throws(
    () => validateCategoryInput({
      name: '建议新增‘AI实操指南’或‘工具与效率’栏目，专门收录面向开发者、从业者的具体工具教程。',
      slug: '',
      description: '',
      sort_order: 0,
    }),
    /栏目名称不能是一整句建议/,
  );
});

test('existing planner prompt tells AI to keep category structure stable', () => {
  const messages = getPlannerPrompt(
    [{ id: 1, name: '前沿研究', slug: 'frontier-research', description: '技术进展' }],
    [{ title: 'AI 应用落地', category_name: '前沿研究', status: 'published' }],
    null,
    [],
  );
  const text = messages.map((message) => message.content).join('\n');

  assert.match(text, /已有栏目是稳定的网站结构/);
  assert.match(text, /不要重命名、删除、合并或替换栏目/);
  assert.match(text, /\"categories\": \[\]/);
});

test('analyzer prompt does not ask AI to change categories', () => {
  const messages = getAnalyzerPrompt([], [{ name: '前沿研究', slug: 'frontier-research' }], []);
  const text = messages.map((message) => message.content).join('\n');

  assert.doesNotMatch(text, /category_changes/);
  assert.match(text, /不得新增、重命名、合并或删除栏目/);
});
