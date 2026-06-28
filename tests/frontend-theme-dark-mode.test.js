const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const themes = [
  { id: 'aurora-press', css: 'aurora-press.css', bodyClass: 'ap-body' },
  { id: 'ink-scroll', css: 'ink-scroll.css', bodyClass: 'ink-body' },
  { id: 'star-harbor', css: 'star-harbor.css', bodyClass: 'sh-body' },
];

test('non-default frontend templates expose a light and dark mode switch contract', () => {
  for (const theme of themes) {
    const themeDir = path.join(root, 'views', 'themes', theme.id);
    const head = fs.readFileSync(path.join(themeDir, 'partials', 'head.ejs'), 'utf8');
    const header = fs.readFileSync(path.join(themeDir, 'partials', 'header.ejs'), 'utf8');
    const footer = fs.readFileSync(path.join(themeDir, 'partials', 'footer.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'themes', theme.css), 'utf8');

    assert.match(head, /frontend-theme-mode/, `${theme.id} should initialize saved theme mode before paint`);
    assert.match(header, /data-theme-mode-toggle/, `${theme.id} should render a visible theme mode toggle`);
    assert.match(footer, /toggleFrontendThemeMode/, `${theme.id} should provide the toggle script`);
    assert.match(css, new RegExp(`\\[data-theme="dark"\\]\\s+\\.${theme.bodyClass}`), `${theme.id} should style dark mode`);
  }
});

test('template development manual requires independent visual direction and dark mode support', () => {
  const manual = fs.readFileSync(path.join(root, 'docs', 'template-development-manual.md'), 'utf8');

  assert.match(manual, /明暗模式/);
  assert.match(manual, /data-theme/);
  assert.match(manual, /不能复刻|不得复刻|不要复刻/);
});
