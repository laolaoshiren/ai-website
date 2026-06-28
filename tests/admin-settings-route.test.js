const test = require('node:test');
const assert = require('node:assert/strict');

test('admin settings normalizes duplicate checkbox values to the submitted checkbox state', () => {
  const { normalizeSettingValue } = require('../routes/admin');

  assert.equal(normalizeSettingValue(['0', '1']), '1');
  assert.equal(normalizeSettingValue(['0']), '0');
  assert.equal(normalizeSettingValue('1'), '1');
});

test('admin settings normalizes Tavily keys into one unique key per line', () => {
  const { normalizeTavilyKeyInput } = require('../routes/admin');

  assert.equal(
    normalizeTavilyKeyInput(' tvly-a\r\n tvly-b, tvly-c \n tvly-a '),
    'tvly-a\ntvly-b\ntvly-c',
  );
});

test('admin settings preserves all Tavily keys when duplicate form fields submit an array', () => {
  const { normalizeTavilyKeyInput } = require('../routes/admin');

  assert.equal(
    normalizeTavilyKeyInput([' tvly-a\r\ntvly-b ', 'tvly-c,tvly-b']),
    'tvly-a\ntvly-b\ntvly-c',
  );
});
