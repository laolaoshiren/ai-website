const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

test('admin categories view exposes edit controls and contains long fields in a scrollable table', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'categories.ejs'),
    {
      title: '栏目管理',
      currentPath: '/admin/categories',
      csrfToken: 'token',
      categories: [
        {
          id: 8,
          name: '建议新增‘AI实操指南’或‘工具与效率’栏目，专门收录面向开发者、从业者的具体工具教程。',
          slug: 'p-bad-category-suggestion',
          description: '',
          sort_order: 0,
          article_count: 0,
        },
      ],
      success: '',
      error: '',
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /class="table-scroll"/);
  assert.match(html, /action="\/admin\/categories\/8\/edit"/);
  assert.match(html, /name="name"/);
  assert.match(html, /编辑/);
  assert.match(html, /td-category-name/);
  assert.match(html, /\/css\/admin\.css\?v=3/);
});
