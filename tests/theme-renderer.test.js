const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../db/database');
const { saveGeneratedTheme } = require('../ai/theme-engine');
const { normalizePackage } = require('../ai/theme-agent');

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

function createResponse() {
  return {
    statusCode: 200,
    rendered: null,
    sent: null,
    status(code) { this.statusCode = code; return this; },
    render(view, data) { this.rendered = { view, data }; return this; },
    send(html) { this.sent = html; return this; },
  };
}

test('theme renderer falls back to builtin templates when active AI theme fails', () => {
  const { renderThemePage } = require('../routes/theme-renderer');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-renderer-'));
  const current = db.getDb();
  current.ai_themes = [];
  current.settings.ai_theme_enabled = '1';
  current.settings.theme_mode = 'ai_active';
  current.settings.active_theme_id = 'broken-theme';
  current.settings.ai_theme_locked = '1';
  current.ai_themes.push({
    id: 1,
    theme_id: 'broken-theme',
    status: 'published',
    locked: true,
    score: 90,
  });

  const pkg = normalizePackage({}, { site_type: 'blog', title: 'Broken' });
  pkg.files['templates/home.ejs'] = '<%= missing.value %>';
  saveGeneratedTheme(pkg, { id: 'broken-theme', rootDir });

  const res = createResponse();
  renderThemePage(
    { path: '/', query: {}, session: null },
    res,
    'home',
    { title: 'Home', latest: [], featured: [] },
    { rootDir },
  );

  assert.equal(res.rendered.view, 'pages/home');
  assert.equal(res.sent, null);
});

test('theme renderer allows admin preview but blocks visitor preview', () => {
  const { renderThemePage } = require('../routes/theme-renderer');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-renderer-'));
  const current = db.getDb();
  current.ai_themes = [{
    id: 1,
    theme_id: 'preview-theme',
    status: 'preview',
    locked: false,
    score: 92,
  }];

  const pkg = normalizePackage({}, { site_type: 'news', title: 'Preview' });
  pkg.files['templates/home.ejs'] = '<main><h1>Preview Theme Works</h1><link rel="stylesheet" href="<%= themeAssetUrl %>"></main>';
  saveGeneratedTheme(pkg, { id: 'preview-theme', rootDir });

  const visitorRes = createResponse();
  renderThemePage(
    { path: '/', query: { preview_theme: 'preview-theme' }, session: null },
    visitorRes,
    'home',
    { title: 'Home' },
    { rootDir },
  );
  assert.equal(visitorRes.rendered.view, 'pages/home');

  const adminRes = createResponse();
  renderThemePage(
    { path: '/', query: { preview_theme: 'preview-theme' }, session: { admin: true } },
    adminRes,
    'home',
    { title: 'Home' },
    { rootDir },
  );
  assert.match(adminRes.sent, /Preview Theme Works/);
  assert.match(adminRes.sent, /\/themes\/preview-theme\/assets\/theme\.css/);
});
