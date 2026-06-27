const test = require('node:test');
const assert = require('node:assert/strict');

const { parseJSON } = require('../ai/client');

test('extracts the first valid JSON object even when prose contains invalid braces first', () => {
  const data = parseJSON('说明：{这不是JSON}\n真正结果：{"title":"A100实测","items":[1,2]}');

  assert.equal(data.title, 'A100实测');
  assert.deepEqual(data.items, [1, 2]);
});

test('repairs common trailing commas in AI JSON responses', () => {
  const data = parseJSON('```json\n{"title":"端侧模型", "tags":["AI","手机",],}\n```');

  assert.equal(data.title, '端侧模型');
  assert.deepEqual(data.tags, ['AI', '手机']);
});
