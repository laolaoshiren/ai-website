const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { BACKUP_SECTIONS } = require('../utils/admin-backup');

test('admin backup page renders export and restore controls for every section', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'backup.ejs'),
    {
      title: '备份还原',
      currentPath: '/admin/backup',
      sections: BACKUP_SECTIONS,
      csrfToken: 'token',
      success: '',
      error: '',
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /action="\/admin\/backup\/export"/);
  assert.match(html, /action="\/admin\/backup\/restore"/);
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /type="file" name="backup_file"/);
  assert.match(html, /accept="\.zip,\.json,application\/zip,application\/json"/);
  assert.match(html, /备份还原/);
  for (const section of BACKUP_SECTIONS) {
    assert.match(html, new RegExp(`value="${section.id}"`));
    assert.match(html, new RegExp(section.filename.replace('.', '\\.')));
  }
});

test('admin backup routes and sidebar entry are registered', () => {
  const adminRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'layout-open.ejs'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

  assert.match(adminRoute, /router\.get\('\/backup'/);
  assert.match(adminRoute, /router\.post\('\/backup\/export'/);
  assert.match(adminRoute, /router\.post\('\/backup\/restore'/);
  assert.match(adminRoute, /parseMultipartForm/);
  assert.match(sidebar, /\/admin\/backup/);
  assert.match(css, /\.backup-option-grid/);
});
