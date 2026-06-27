const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('admin providers view tests providers inline without navigating away', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'providers.ejs'),
    {
      title: 'AI 提供商',
      currentPath: '/admin/providers',
      csrfToken: 'token',
      success: '',
      error: '',
      providers: [
        {
          id: 12,
          name: 'DeepSeek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-demo',
          model: 'deepseek-chat',
          enabled: 1,
          request_count: 3,
          error_count: 0,
        },
      ],
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.doesNotMatch(html, /action="\/admin\/providers\/12\/test"/);
  assert.match(html, /data-provider-test-button/);
  assert.match(html, /data-provider-test-url="\/admin\/providers\/12\/test"/);
  assert.match(html, /id="provider-test-result-12"/);
  assert.match(html, /preventDefault\(\)/);
});

test('admin provider form fields use readable text colors in dark mode', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

  assert.match(
    css,
    /\.form-group input, \.form-group textarea, \.form-group select \{[^}]*color:\s*var\(--text\)/s,
  );
});
