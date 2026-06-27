const test = require('node:test');
const assert = require('node:assert/strict');

test('ranks AI providers by health before usage count', () => {
  const { rankAIProviders } = require('../ai/client');
  const ranked = rankAIProviders([
    { id: 1, name: 'Broken cheap', enabled: true, request_count: 20, error_count: 18 },
    { id: 2, name: 'Healthy busy', enabled: true, request_count: 80, error_count: 1 },
    { id: 3, name: 'Fresh', enabled: true, request_count: 0, error_count: 0 },
  ]);

  assert.equal(ranked[0].name, 'Fresh');
  assert.equal(ranked[1].name, 'Healthy busy');
  assert.equal(ranked[2].name, 'Broken cheap');
});

test('classifies provider authentication failures for automatic cooldown', () => {
  const { classifyProviderError } = require('../ai/client');

  assert.equal(classifyProviderError(new Error('API 错误 (401): Invalid API Key')), 'auth');
  assert.equal(classifyProviderError(new Error('API 错误 (429): rate limited')), 'rate_limit');
  assert.equal(classifyProviderError(new Error('fetch failed')), 'network');
});
