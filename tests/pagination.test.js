const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPagination } = require('../routes/pagination');

test('builds a clamped pagination window with item range metadata', () => {
  const pagination = buildPagination({
    totalItems: 314,
    requestedPage: '99',
    perPage: 30,
    basePath: '/archive',
  });

  assert.equal(pagination.page, 11);
  assert.equal(pagination.totalPages, 11);
  assert.equal(pagination.startItem, 301);
  assert.equal(pagination.endItem, 314);
  assert.equal(pagination.offset, 300);
  assert.equal(pagination.prevHref, '/archive?page=10');
  assert.equal(pagination.nextHref, null);
  assert.deepEqual(pagination.items.map((item) => item.type === 'page' ? item.page : item.type), [
    1,
    'ellipsis',
    9,
    10,
    11,
  ]);
});

test('preserves non-empty query parameters when building page hrefs', () => {
  const pagination = buildPagination({
    totalItems: 75,
    requestedPage: '2',
    perPage: 20,
    basePath: '/admin/articles',
    query: {
      q: 'AI Agent',
      status: 'published',
      sort: 'views',
      cat: '',
      page: '2',
    },
  });

  assert.equal(pagination.prevHref, '/admin/articles?q=AI+Agent&status=published&sort=views&page=1');
  assert.equal(pagination.nextHref, '/admin/articles?q=AI+Agent&status=published&sort=views&page=3');
  assert.equal(pagination.items[1].href, '/admin/articles?q=AI+Agent&status=published&sort=views&page=2');
  assert.equal(pagination.items[1].isCurrent, true);
});

test('returns stable metadata for empty result sets', () => {
  const pagination = buildPagination({
    totalItems: 0,
    requestedPage: '-2',
    perPage: 20,
    basePath: '/search',
    query: { q: 'missing' },
  });

  assert.equal(pagination.page, 1);
  assert.equal(pagination.totalPages, 1);
  assert.equal(pagination.startItem, 0);
  assert.equal(pagination.endItem, 0);
  assert.equal(pagination.prevHref, null);
  assert.equal(pagination.nextHref, null);
  assert.deepEqual(pagination.items.map((item) => item.page), [1]);
});
