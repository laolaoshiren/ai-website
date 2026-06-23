const test = require('node:test');
const assert = require('node:assert/strict');

const { buildArchivePagination } = require('../routes/archive-pagination');

const articles = [
  { id: 1, title: 'A', published_at: '2026-06-24 08:00:00' },
  { id: 2, title: 'B', published_at: '2026-06-20 08:00:00' },
  { id: 3, title: 'C', published_at: '2026-05-18 08:00:00' },
  { id: 4, title: 'D', published_at: '2026-05-12 08:00:00' },
  { id: 5, title: 'E', published_at: '2026-04-21 08:00:00' },
  { id: 6, title: 'F', published_at: '2026-04-03 08:00:00' },
  { id: 7, title: 'G', published_at: '2026-03-30 08:00:00' },
];

test('paginates archive by article count and groups only the current page by month', () => {
  const result = buildArchivePagination(articles, '2', { perPage: 3 });

  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 3);
  assert.equal(result.totalArticles, 7);
  assert.equal(result.startArticle, 4);
  assert.equal(result.endArticle, 6);

  assert.deepEqual(
    result.archive.map(([month, items]) => [month, items.map((item) => item.id)]),
    [
      ['2026-05', [4]],
      ['2026-04', [5, 6]],
    ],
  );
});

test('clamps invalid archive pages into the available range', () => {
  assert.equal(buildArchivePagination(articles, 'not-a-number', { perPage: 3 }).page, 1);

  const lastPage = buildArchivePagination(articles, '99', { perPage: 3 });
  assert.equal(lastPage.page, 3);
  assert.deepEqual(lastPage.archive.map(([month, items]) => [month, items.map((item) => item.id)]), [
    ['2026-03', [7]],
  ]);
});

test('returns stable pagination metadata for an empty archive', () => {
  const result = buildArchivePagination([], '3', { perPage: 30 });

  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.totalArticles, 0);
  assert.equal(result.startArticle, 0);
  assert.equal(result.endArticle, 0);
  assert.deepEqual(result.archive, []);
});
