const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('admin theme page exposes AI theme controls, preview, reports, and history', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'themes.ejs'),
    {
      title: 'AI Theme Engine',
      currentPath: '/admin/themes',
      csrfToken: 'token',
      success: '',
      error: '',
      config: {
        ai_theme_enabled: '1',
        theme_mode: 'builtin',
        active_theme_id: '',
        site_type: 'blog',
      },
      themes: [{
        theme_id: 'theme-a',
        name: 'Theme A',
        site_type: 'blog',
        status: 'preview',
        score: 91,
        locked: false,
        review_report: { pass: true, issues: [] },
        created_at: '2026-06-28 10:00:00',
      }],
      activeTheme: null,
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /name="ai_theme_enabled"/);
  assert.match(html, /name="site_type"/);
  assert.match(html, /action="\/admin\/themes\/generate"/);
  assert.match(html, /action="\/admin\/themes\/rewrite"/);
  assert.match(html, /\/\?preview_theme=theme-a/);
  assert.match(html, /Theme A/);
  assert.match(html, /91/);
});

test('admin sidebar links to the AI theme page', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'layout-open.ejs'), 'utf8');
  assert.match(layout, /\/admin\/themes/);
});
