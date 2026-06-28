const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('frontend theme registry defaults safely and exposes the new built-in template', () => {
  const {
    DEFAULT_FRONTEND_THEME,
    listFrontendThemes,
    resolveFrontendTheme,
    getFrontendThemeView,
  } = require('../routes/frontend-theme');

  const themes = listFrontendThemes();
  assert.equal(DEFAULT_FRONTEND_THEME, 'builtin-default');
  assert.deepEqual(themes.map(theme => theme.id), ['builtin-default', 'aurora-press']);
  assert.equal(resolveFrontendTheme('').id, 'builtin-default');
  assert.equal(resolveFrontendTheme('missing-theme').id, 'builtin-default');
  assert.equal(resolveFrontendTheme('aurora-press').id, 'aurora-press');
  assert.equal(getFrontendThemeView('builtin-default', 'home'), 'pages/home');
  assert.equal(getFrontendThemeView('aurora-press', 'home'), 'themes/aurora-press/home');
});

test('public pages render through the frontend theme renderer', () => {
  const publicRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'public.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(publicRoute, /renderFrontendPage/);
  assert.match(server, /renderFrontendPage/);
  assert.doesNotMatch(publicRoute, /res\.render\('pages\/home'/);
  assert.doesNotMatch(publicRoute, /res\.render\('pages\/article'/);
  assert.doesNotMatch(server, /res\.status\(404\)\.render\('pages\/404'/);
});

