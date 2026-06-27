const test = require('node:test');
const assert = require('node:assert/strict');

test('admin settings normalizes duplicate checkbox values to the submitted checkbox state', () => {
  const { normalizeSettingValue } = require('../routes/admin');

  assert.equal(normalizeSettingValue(['0', '1']), '1');
  assert.equal(normalizeSettingValue(['0']), '0');
  assert.equal(normalizeSettingValue('1'), '1');
});
