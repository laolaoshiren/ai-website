const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db/database');

let snapshot;

test.before(async () => {
  await db.initDb();
  snapshot = JSON.parse(JSON.stringify(db.getDb()));
});

test.after(() => {
  const current = db.getDb();
  for (const key of Object.keys(current)) delete current[key];
  Object.assign(current, snapshot);
  db.saveDb();
});

function resetContent() {
  const current = db.getDb();
  current.categories = [
    { id: 1, name: '前沿研究', slug: 'frontier-research', description: '', sort_order: 1, parent_id: null },
    { id: 2, name: '产业动态', slug: 'industry-news', description: '', sort_order: 2, parent_id: null },
  ];
  current.pages = [];
  current._counters.categories = 2;
  current._counters.pages = 0;
}

test('insertPage assigns a valid category when category is missing or invalid', () => {
  resetContent();

  const missingId = db.insertPage({ title: 'Missing category', slug: 'missing-category', status: 'planned' });
  const invalidId = db.insertPage({ title: 'Invalid category', slug: 'invalid-category', status: 'planned', category_id: 999 });

  assert.equal(db.getPageById(missingId).category_id, 1);
  assert.equal(db.getPageById(invalidId).category_id, 1);
  assert.equal(db.getPageById(missingId).category_name, '前沿研究');
});

test('updatePage does not allow clearing or orphaning an article category', () => {
  resetContent();
  const pageId = db.insertPage({ title: 'Valid category', slug: 'valid-category', status: 'draft', category_id: 2 });

  db.updatePage(pageId, { category_id: null });
  assert.equal(db.getPageById(pageId).category_id, 1);

  db.updatePage(pageId, { category_id: 999 });
  assert.equal(db.getPageById(pageId).category_id, 1);
});

test('deleteCategory reassigns affected articles instead of leaving them uncategorized', () => {
  resetContent();
  const pageId = db.insertPage({ title: 'Industry article', slug: 'industry-article', status: 'published', category_id: 2 });

  db.deleteCategory(2);

  assert.equal(db.getPageById(pageId).category_id, 1);
  assert.equal(db.getPageById(pageId).category_slug, 'frontier-research');
});

test('repairExistingPageCategories fixes historical missing and orphan category references', () => {
  resetContent();
  const current = db.getDb();
  current.pages.push(
    { id: 1, title: 'No category', slug: 'no-category', status: 'published', category_id: null },
    { id: 2, title: 'Orphan category', slug: 'orphan-category', status: 'planned', category_id: 999 },
  );
  current._counters.pages = 2;

  const repaired = db.repairExistingPageCategories();

  assert.equal(repaired, 2);
  assert.equal(db.getPageById(1).category_id, 1);
  assert.equal(db.getPageById(2).category_id, 1);
});
