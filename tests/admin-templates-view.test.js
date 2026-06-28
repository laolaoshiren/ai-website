const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');

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

test('admin template settings page scales to a large searchable template library', async () => {
  const themes = Array.from({ length: 24 }, (_, index) => ({
    id: index === 0 ? 'builtin-default' : `theme-${index}`,
    name: index === 0 ? '默认模板' : `主题 ${index}`,
    description: `适合内容站的第 ${index + 1} 套前台模板，支持响应式布局。`,
    badge: index === 0 ? '默认' : index % 3 === 0 ? '杂志' : '博客',
  }));

  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'templates.ejs'),
    {
      title: '模板设置',
      currentPath: '/admin/templates',
      csrfToken: 'token',
      success: '',
      error: '',
      themes,
      currentThemeId: 'theme-7',
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const document = dom.window.document;

  assert.equal(document.querySelectorAll('[data-template-card]').length, 24);
  assert.equal(document.querySelector('[data-template-library]').dataset.total, '24');
  assert.ok(document.getElementById('templateSearchInput'));
  assert.ok(document.querySelector('[data-template-filter="all"]'));
  assert.ok(document.querySelector('[data-template-filter="active"]'));
  assert.ok(document.querySelector('[data-template-count]'));
  assert.ok(document.querySelector('.template-active-summary'));
  assert.ok(document.querySelector('.template-library-scroll'));
  assert.equal(document.querySelector('[data-template-id="theme-7"]').classList.contains('is-active'), true);

  document.getElementById('templateSearchInput').value = '主题 11';
  dom.window.filterTemplates();

  const visibleCards = [...document.querySelectorAll('[data-template-card]')]
    .filter(card => card.hidden === false);
  assert.equal(visibleCards.length, 1);
  assert.equal(visibleCards[0].dataset.templateId, 'theme-11');
  assert.match(document.querySelector('[data-template-count]').textContent, /1/);
});

test('template settings styles and admin css cache version support the library layout', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'layout-open.ejs'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

  assert.match(layout, /\/css\/admin\.css\?v=7/);
  assert.match(css, /\.template-library-toolbar \{/);
  assert.match(css, /\.template-library-scroll \{/);
  assert.match(css, /\.template-card-grid \{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(280px,\s*100%\),\s*1fr\)\)/s);
  assert.match(css, /\.template-sticky-actions \{/);
});

test('admin routes include template settings GET and POST endpoints', () => {
  const adminRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');

  assert.match(adminRoute, /router\.get\('\/templates'/);
  assert.match(adminRoute, /router\.post\('\/templates\/select'/);
  assert.match(adminRoute, /frontend_theme/);
});

