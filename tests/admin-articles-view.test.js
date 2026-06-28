const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

test('admin articles view marks articles that have a reviewed cover image', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'articles.ejs'),
    {
      title: 'Articles',
      currentPath: '/admin/articles',
      csrfToken: 'token',
      success: '',
      error: '',
      pages: [
        {
          id: 1,
          title: 'With image',
          slug: 'with-image',
          status: 'published',
          category_name: 'AI',
          view_count: 3,
          created_at: '2026-06-28 10:00:00',
          cover_image: '/images/articles/with-image.png',
          image_review_status: 'pass',
        },
        {
          id: 2,
          title: 'No image',
          slug: 'no-image',
          status: 'published',
          category_name: 'AI',
          view_count: 1,
          created_at: '2026-06-28 11:00:00',
          cover_image: null,
        },
      ],
      status: '',
      q: '',
      sort: 'newest',
      cat: '',
      pagination: { totalItems: 2, totalPages: 1, currentPage: 1, items: [], hasPrev: false, hasNext: false },
      total: 2,
      categories: [],
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /article-image-badge has-image/);
  assert.match(html, /article-image-badge no-image/);
  assert.match(html, /\/images\/articles\/with-image\.png/);
});

