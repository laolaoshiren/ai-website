const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('frontend theme registry defaults safely and exposes all built-in templates with Chinese names', () => {
  const {
    DEFAULT_FRONTEND_THEME,
    listFrontendThemes,
    resolveFrontendTheme,
    resolveFrontendThemeForRequest,
    getFrontendThemeView,
  } = require('../routes/frontend-theme');

  const themes = listFrontendThemes();
  assert.equal(DEFAULT_FRONTEND_THEME, 'builtin-default');
  assert.deepEqual(themes.map(theme => theme.id), ['builtin-default', 'aurora-press', 'ink-scroll', 'star-harbor', 'lumen-flow', 'neo-blog']);
  for (const theme of themes) {
    // Names stay Chinese; only the explicit "GLM5.2" authorship tag is allowed.
    assert.doesNotMatch(theme.name.replace(/\s*GLM5\.2\s*/, ''), /[A-Za-z]/, `${theme.id} should use a Chinese display name`);
  }
  assert.equal(resolveFrontendTheme('').id, 'builtin-default');
  assert.equal(resolveFrontendTheme('missing-theme').id, 'builtin-default');
  assert.equal(resolveFrontendTheme('aurora-press').id, 'aurora-press');
  assert.equal(resolveFrontendTheme('ink-scroll').id, 'ink-scroll');
  assert.equal(resolveFrontendTheme('star-harbor').id, 'star-harbor');
  assert.equal(resolveFrontendTheme('lumen-flow').id, 'lumen-flow');
  assert.equal(resolveFrontendTheme('neo-blog').id, 'neo-blog');
  assert.equal(getFrontendThemeView('builtin-default', 'home'), 'pages/home');
  assert.equal(getFrontendThemeView('aurora-press', 'home'), 'themes/aurora-press/home');
  assert.equal(getFrontendThemeView('ink-scroll', 'home'), 'themes/ink-scroll/home');
  assert.equal(getFrontendThemeView('star-harbor', 'home'), 'themes/star-harbor/home');
  assert.equal(getFrontendThemeView('lumen-flow', 'home'), 'themes/lumen-flow/home');
  assert.equal(getFrontendThemeView('neo-blog', 'home'), 'themes/neo-blog/home');
  assert.equal(resolveFrontendThemeForRequest({ query: { preview_theme: 'ink-scroll' } }, { frontend_theme: 'aurora-press' }).id, 'ink-scroll');
  assert.equal(resolveFrontendThemeForRequest({ query: { preview_theme: 'missing-theme' } }, { frontend_theme: 'aurora-press' }).id, 'aurora-press');
  assert.equal(resolveFrontendThemeForRequest({ query: {} }, { frontend_theme: 'star-harbor' }).id, 'star-harbor');
  assert.equal(resolveFrontendThemeForRequest({ query: { preview_theme: 'lumen-flow' } }, { frontend_theme: 'builtin-default' }).id, 'lumen-flow');
  assert.equal(resolveFrontendThemeForRequest({ query: { preview_theme: 'neo-blog' } }, { frontend_theme: 'builtin-default' }).id, 'neo-blog');
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

