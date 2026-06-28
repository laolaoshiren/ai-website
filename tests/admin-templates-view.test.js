const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('admin sidebar exposes an independent template settings section', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'layout-open.ejs'), 'utf8');

  assert.match(sidebar, /\/admin\/templates/);
  assert.match(sidebar, /模板设置/);
});

test('admin template settings page can switch between built-in frontend templates', async () => {
  const { listFrontendThemes } = require('../routes/frontend-theme');
  const themes = listFrontendThemes();
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'templates.ejs'),
    {
      title: '模板设置',
      currentPath: '/admin/templates',
      csrfToken: 'token',
      success: '',
      error: '',
      themes,
      currentThemeId: 'aurora-press',
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /action="\/admin\/templates\/select"/);
  assert.match(html, /name="frontend_theme"/);
  assert.match(html, /value="builtin-default"/);
  assert.match(html, /value="aurora-press"/);
  assert.match(html, /checked/);
  assert.match(html, /模板设置/);
  assert.match(html, /查看前台/);
});

test('admin routes include template settings GET and POST endpoints', () => {
  const adminRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');

  assert.match(adminRoute, /router\.get\('\/templates'/);
  assert.match(adminRoute, /router\.post\('\/templates\/select'/);
  assert.match(adminRoute, /frontend_theme/);
});

