const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('admin providers view tests providers inline without navigating away', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'providers.ejs'),
    {
      title: 'AI Providers',
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
      imageProviders: [],
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

test('admin provider cards keep long API addresses inside the card', async () => {
  const longUrl = 'https://api.cloudflare.com/client/v4/accounts/a9e3b28386b04897b33cc17638774eac/ai/v1/openai/chat/completions';
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'providers.ejs'),
    {
      title: 'AI Providers',
      currentPath: '/admin/providers',
      csrfToken: 'token',
      success: '',
      error: '',
      providers: [
        {
          id: 21,
          name: 'CloudFlare',
          base_url: longUrl,
          api_key: 'sk-demo',
          model: '@cf/zai-org/glm-5.2',
          enabled: 1,
          request_count: 41,
          error_count: 38,
        },
      ],
      imageProviders: [],
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

  assert.match(html, new RegExp(longUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /\.provider-card \{[^}]*min-width:\s*0/s);
  assert.match(css, /\.provider-info code \{[^}]*max-width:\s*100%/s);
  assert.match(css, /\.provider-info code \{[^}]*overflow-wrap:\s*anywhere/s);
});

test('admin providers view manages image providers separately from text providers', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'providers.ejs'),
    {
      title: 'AI Providers',
      currentPath: '/admin/providers',
      csrfToken: 'token',
      success: '',
      error: '',
      providers: [],
      imageProviders: [
        {
          id: 5,
          name: 'Agnes Image',
          base_url: 'https://apihub.agnes-ai.com/v1',
          api_key: 'sk-img-a\nsk-img-b',
          model: 'agnes-image-2.1-flash',
          enabled: 1,
          request_count: 2,
          error_count: 0,
        },
      ],
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /id="imageProviderForm"/);
  assert.match(html, /\/admin\/image-providers\/add/);
  assert.match(html, /data-image-provider-test-button/);
  assert.match(html, /data-provider-test-url="\/admin\/image-providers\/5\/test"/);
  assert.doesNotMatch(html, /action="\/admin\/image-providers\/5\/test"/);
});
