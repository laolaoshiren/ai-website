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

test('failed provider calls carry provider and model metadata for agent logs', async () => {
  const { callProvider } = require('../ai/client');
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: { message: 'rate limited' } }),
  });

  try {
    await assert.rejects(
      () => callProvider(
        { id: 9, name: 'OpenRouter', base_url: 'https://api.example.com/v1', api_key: 'sk-demo', model: 'gpt-4.1-mini' },
        [{ role: 'user', content: 'hi' }],
        { first: true },
      ),
      (err) => {
        assert.equal(err.ai_provider, 'OpenRouter');
        assert.equal(err.ai_provider_id, 9);
        assert.equal(err.ai_model, 'gpt-4.1-mini');
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});
