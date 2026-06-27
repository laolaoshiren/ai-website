const test = require('node:test');
const assert = require('node:assert/strict');

test('MoA mode is opt-in and limited to high-value writing tasks', () => {
  const { shouldUseMoA } = require('../ai/moa');

  assert.equal(shouldUseMoA({ taskType: 'generate_content' }, { moa_enabled: '0' }), false);
  assert.equal(shouldUseMoA({ taskType: 'generate_content' }, { moa_enabled: '1' }), true);
  assert.equal(shouldUseMoA({ taskType: 'humanize_content' }, { moa_enabled: '1' }), true);
  assert.equal(shouldUseMoA({ taskType: 'plan_structure' }, { moa_enabled: '1' }), false);
  assert.equal(shouldUseMoA({ taskType: 'generate_content', moa: false }, { moa_enabled: '1' }), false);
});

test('MoA aggregates multiple successful candidates into one final response', async () => {
  const { runMoA, buildAggregatorMessages } = require('../ai/moa');
  const calls = [];
  const providers = [
    { id: 1, name: 'A', enabled: true, request_count: 0, error_count: 0, model: 'a-model' },
    { id: 2, name: 'B', enabled: true, request_count: 0, error_count: 0, model: 'b-model' },
    { id: 3, name: 'C', enabled: true, request_count: 0, error_count: 0, model: 'c-model' },
  ];

  const result = await runMoA(
    [{ role: 'user', content: '写一篇有真实信息密度的文章' }],
    { taskType: 'generate_content', jsonMode: true, maxTokens: 1000 },
    {
      getProviders: () => providers,
      rankProviders: (items) => items,
      callProvider: async (provider, messages, options) => {
        calls.push({ provider: provider.name, messages, jsonMode: options.jsonMode });
        if (calls.length <= 3) {
          return { content: `候选稿-${provider.name}`, provider: provider.name, model: provider.model, tokensUsed: 10 };
        }
        assert.match(messages[0].content, /候选稿-A/);
        assert.match(messages[0].content, /候选稿-B/);
        assert.match(messages[0].content, /候选稿-C/);
        return { content: '{"title":"聚合稿","content_md":"最终正文"}', provider: provider.name, model: provider.model, tokensUsed: 20 };
      },
      onSuccess: () => {},
      onFailure: () => {},
    }
  );

  assert.equal(result.content, '{"title":"聚合稿","content_md":"最终正文"}');
  assert.equal(result.moa, true);
  assert.equal(result.candidates.length, 3);
  assert.equal(calls.length, 4);

  const messages = buildAggregatorMessages(
    [{ role: 'user', content: '原始任务' }],
    [{ provider: 'A', model: 'a-model', content: '候选稿-A' }],
    { jsonMode: true }
  );
  assert.match(messages[0].content, /只返回合法 JSON/);
});

test('MoA expands comma-separated models into separate candidate slots', async () => {
  const { expandProviderModels } = require('../ai/moa');
  const candidates = expandProviderModels([
    { id: 1, name: 'Multi', enabled: true, model: 'alpha,beta' },
    { id: 2, name: 'Single', enabled: true, model: 'gamma' },
  ]);

  assert.deepEqual(
    candidates.map((candidate) => `${candidate.name}:${candidate.model}`),
    ['Multi:alpha', 'Multi:beta', 'Single:gamma']
  );
});

test('MoA fails fast when fewer than two candidates succeed', async () => {
  const { runMoA } = require('../ai/moa');
  const providers = [
    { id: 1, name: 'A', enabled: true, request_count: 0, error_count: 0, model: 'a-model' },
    { id: 2, name: 'B', enabled: true, request_count: 0, error_count: 0, model: 'b-model' },
  ];

  await assert.rejects(
    () => runMoA(
      [{ role: 'user', content: '写文章' }],
      { taskType: 'generate_content' },
      {
        getProviders: () => providers,
        rankProviders: (items) => items,
        callProvider: async (provider) => {
          if (provider.name === 'A') return { content: '候选稿-A', provider: 'A', model: 'a-model', tokensUsed: 10 };
          throw new Error('provider down');
        },
        onSuccess: () => {},
        onFailure: () => {},
      }
    ),
    /MoA 候选结果不足/
  );
});

test('MoA JSON parse failures should fall back to single-model JSON generation', () => {
  const { shouldFallbackFromMoAParseError } = require('../ai/client');

  assert.equal(
    shouldFallbackFromMoAParseError({ moa: true }, new Error('无法从 AI 响应中解析 JSON')),
    true
  );
  assert.equal(
    shouldFallbackFromMoAParseError({ moa: false }, new Error('无法从 AI 响应中解析 JSON')),
    false
  );
});
