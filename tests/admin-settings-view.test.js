const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');

test('admin settings page uses a readable responsive form layout', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
    {
      title: '系统设置',
      currentPath: '/admin/settings',
      csrfToken: 'token',
      success: '',
      error: '',
      config: {
        site_title: 'AI 纪元',
        site_description: '追踪人工智能最新进展，深度解读前沿技术',
        site_theme: '通用人工智能前沿技术与行业创新观测',
        site_direction: '聚焦 AI 最新技术动态、产品发布、行业应用',
        site_url: 'https://aiweb.bt199.com',
        site_language: 'zh-CN',
        work_mode: 'smart',
        rage_level: '3',
      },
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /class="settings-form-grid"/);
  assert.match(html, /class="form-group settings-field-wide"/);
  assert.match(html, /class="settings-textarea"/);
});

test('admin settings page exposes the MoA mode switch', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
    {
      title: '系统设置',
      currentPath: '/admin/settings',
      csrfToken: 'token',
      success: '',
      error: '',
      config: {
        site_title: 'AI 纪元',
        site_description: '测试描述',
        site_url: 'https://aiweb.bt199.com',
        site_language: 'zh-CN',
        moa_enabled: '1',
        work_mode: 'smart',
        rage_level: '3',
      },
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /name="moa_enabled"/);
  assert.match(html, /value="1" checked/);
  assert.match(html, /MoA/);
});

test('admin settings page manages Tavily keys with a modal and validation action', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
    {
      title: '系统设置',
      currentPath: '/admin/settings',
      csrfToken: 'token',
      success: '',
      error: '',
      config: {
        site_title: 'AI 纪元',
        site_url: 'https://aiweb.bt199.com',
        site_language: 'zh-CN',
        tavily_api_key: 'tvly-a\ntvly-b',
        work_mode: 'smart',
        rage_level: '3',
      },
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /id="tavilyKeysModal"/);
  assert.match(html, /name="tavily_api_key"/);
  assert.match(html, /\/admin\/settings\/tavily\/save/);
  assert.match(html, /\/admin\/settings\/tavily\/test/);
  assert.match(html, /一键验证|验证/);
  assert.match(html, /剩余额度/);
  assert.match(html, /不可用/);
});

test('admin settings Tavily modal apply persists keys before leaving the page', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
    {
      title: '系统设置',
      currentPath: '/admin/settings',
      csrfToken: 'token',
      success: '',
      error: '',
      config: {
        site_title: 'AI 纪元',
        site_url: 'https://aiweb.bt199.com',
        site_language: 'zh-CN',
        tavily_api_key: 'tvly-a',
        work_mode: 'smart',
        rage_level: '3',
      },
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://aiweb.bt199.com/admin/settings',
    beforeParse(window) {
      window.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        return {
          json: async () => ({ success: true, count: 2, keys: 'tvly-a\ntvly-b' }),
        };
      };
    },
  });

  dom.window.document.getElementById('tavilyKeysInput').value = 'tvly-a\ntvly-b';
  await dom.window.applyTavilyKeysModal();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/admin/settings/tavily/save');
  assert.match(calls[0].options.body, /csrf_token=token/);
  assert.match(calls[0].options.body, /tavily_api_key=tvly-a%0Atvly-b/);
  assert.equal(dom.window.document.getElementById('tavilyKeyCount').textContent, '2');
});

test('admin settings page exposes the article image generation switch', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'settings.ejs'),
    {
      title: '绯荤粺璁剧疆',
      currentPath: '/admin/settings',
      csrfToken: 'token',
      success: '',
      error: '',
      config: {
        site_title: 'AI 绾厓',
        site_url: 'https://aiweb.bt199.com',
        site_language: 'zh-CN',
        image_generation_enabled: '1',
        image_cleanup_keep_days: '180',
        image_cleanup_max_mb: '2048',
        work_mode: 'smart',
        rage_level: '3',
      },
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /name="image_generation_enabled"/);
  assert.match(html, /value="1" checked/);
  assert.match(html, /image_cleanup_keep_days/);
  assert.match(html, /image_cleanup_max_mb/);
});

test('admin settings form CSS avoids cramped one-row fields and native bright scrollbars', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

  assert.match(css, /\.settings-form-grid \{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.settings-field-wide \{[^}]*grid-column:\s*span 2/s);
  assert.match(css, /\.settings-textarea \{[^}]*min-height:\s*96px/s);
  assert.match(css, /\.form-group textarea \{[^}]*scrollbar-color:\s*var\(--border\)\s*#10101a/s);
});
