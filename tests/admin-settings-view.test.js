const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

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

test('admin settings form CSS avoids cramped one-row fields and native bright scrollbars', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

  assert.match(css, /\.settings-form-grid \{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.settings-field-wide \{[^}]*grid-column:\s*span 2/s);
  assert.match(css, /\.settings-textarea \{[^}]*min-height:\s*96px/s);
  assert.match(css, /\.form-group textarea \{[^}]*scrollbar-color:\s*var\(--border\)\s*#10101a/s);
});
