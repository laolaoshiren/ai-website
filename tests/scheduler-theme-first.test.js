const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('cold start prepares AI theme before content planning', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scheduler', 'index.js'), 'utf8');
  const themeIndex = source.indexOf('ensurePublishedTheme');
  const plannerIndex = source.indexOf('planStructure');

  assert.notEqual(themeIndex, -1);
  assert.notEqual(plannerIndex, -1);
  assert.ok(themeIndex < plannerIndex);
});
