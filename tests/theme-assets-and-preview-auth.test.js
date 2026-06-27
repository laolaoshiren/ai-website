const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('theme asset resolver only serves files from a theme assets directory', () => {
  const { resolveThemeAssetPath } = require('../routes/theme-assets');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-assets-'));
  const cssPath = path.join(rootDir, 'theme-a', 'assets', 'theme.css');
  fs.mkdirSync(path.dirname(cssPath), { recursive: true });
  fs.writeFileSync(cssPath, 'body{}', 'utf8');

  assert.equal(resolveThemeAssetPath('theme-a', 'theme.css', { rootDir }), cssPath);
  assert.equal(resolveThemeAssetPath('theme-a', '../templates/home.ejs', { rootDir }), null);
  assert.equal(resolveThemeAssetPath('../theme-a', 'theme.css', { rootDir }), null);
});

test('admin session cookie is scoped to the whole site for frontend theme preview', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.match(source, /admin_session=.*Path=\//);
  assert.doesNotMatch(source, /admin_session=\$\{sess\.id\}; Path=\/admin/);
});
