const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('admin update page renders detection status and update actions', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'update.ejs'),
    {
      title: '系统更新',
      currentPath: '/admin/update',
      csrfToken: 'token',
      success: '',
      error: '',
      status: {
        install: { type: 'docker', label: 'Docker' },
        currentShort: '1111111',
        latestShort: '2222222',
        hasUpdate: true,
        canUpdate: true,
        updateMode: 'docker-worker',
        statusLabel: '发现新版本',
        updateBlockedReason: '',
        runtime: { status: 'idle', message: '执行器就绪' },
      },
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /data-update-page/);
  assert.match(html, /data-check-url="\/admin\/update\/check"/);
  assert.match(html, /data-run-url="\/admin\/update\/run"/);
  assert.match(html, /data-csrf-token="token"/);
  assert.match(html, /Docker/);
  assert.match(html, /1111111/);
  assert.match(html, /2222222/);
  assert.match(html, /立即更新/);
});

test('admin update routes and sidebar entry are registered', () => {
  const adminRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'layout-open.ejs'), 'utf8');

  assert.match(adminRoute, /router\.get\('\/update'/);
  assert.match(adminRoute, /router\.get\('\/update\/check'/);
  assert.match(adminRoute, /router\.post\('\/update\/run'/);
  assert.match(sidebar, /\/admin\/update/);
});
