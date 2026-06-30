const test = require('node:test');
const assert = require('node:assert/strict');

test('scores known and future same-family models in the expected order', () => {
  const { scoreModel, compareModels } = require('../ai/model-intelligence');

  assert.ok(scoreModel('claude-4.9-opus').general_score > scoreModel('claude-4.8-opus').general_score);
  assert.ok(scoreModel('claude-4.8-opus').general_score > scoreModel('gpt-4.1-mini').general_score);
  assert.equal(compareModels('claude-4.9-opus', 'claude-4.8-opus') > 0, true);
});

test('model scoring understands common tier suffixes', () => {
  const { scoreModel } = require('../ai/model-intelligence');

  assert.ok(scoreModel('gpt-4.1').general_score > scoreModel('gpt-4.1-mini').general_score);
  assert.ok(scoreModel('gemini-2.5-pro').reasoning_score > scoreModel('gemini-2.5-flash').reasoning_score);
  assert.ok(scoreModel('qwen3-72b').general_score > scoreModel('qwen3-7b').general_score);
});

test('review routing prefers a stronger available model than the creator model', () => {
  const { selectReviewerModel } = require('../ai/model-intelligence');
  const providers = [
    { id: 1, name: 'A', enabled: true, model: 'gpt-4.1-mini' },
    { id: 2, name: 'B', enabled: true, model: 'claude-4.8-opus' },
  ];

  const selected = selectReviewerModel(providers, {
    creatorModel: 'gpt-4.1-mini',
    capability: 'reasoning',
  });

  assert.equal(selected.provider.name, 'B');
  assert.equal(selected.model, 'claude-4.8-opus');
  assert.equal(selected.reason, 'stronger_model');
});

test('manual model ranking overrides inferred scores for reviewer routing', () => {
  const { selectReviewerModel } = require('../ai/model-intelligence');
  const providers = [
    { id: 1, name: 'Mini Provider', enabled: true, model: 'gpt-4.1-mini' },
    { id: 2, name: 'Claude Provider', enabled: true, model: 'claude-4.8-opus' },
  ];

  const selected = selectReviewerModel(providers, {
    creatorModel: 'claude-4.8-opus',
    capability: 'reasoning',
    manualRankings: ['gpt-4.1-mini', 'claude-4.8-opus'],
  });

  assert.equal(selected.provider.name, 'Mini Provider');
  assert.equal(selected.model, 'gpt-4.1-mini');
  assert.equal(selected.reason, 'manual_override');
});

test('model ranking rows keep manual order ahead of automatic scores', () => {
  const { buildModelRankingRows } = require('../ai/model-intelligence');
  const rows = buildModelRankingRows(
    [
      { id: 1, name: 'A', enabled: true, model: 'claude-4.8-opus,gpt-4.1-mini' },
      { id: 2, name: 'B', enabled: true, model: 'gemini-2.5-pro' },
    ],
    { manualRankings: ['gemini-2.5-pro', 'gpt-4.1-mini'] },
  );

  assert.deepEqual(rows.slice(0, 3).map(row => row.model), ['gemini-2.5-pro', 'gpt-4.1-mini', 'claude-4.8-opus']);
  assert.equal(rows[0].manual_rank, 1);
  assert.equal(rows[1].manual_rank, 2);
  assert.equal(rows[2].manual_rank, null);
});

test('review routing only falls back to same level when no stronger model is available', () => {
  const { selectReviewerModel } = require('../ai/model-intelligence');
  const providers = [{ id: 1, name: 'Solo', enabled: true, model: 'gpt-4.1-mini' }];

  const selected = selectReviewerModel(providers, {
    creatorModel: 'gpt-4.1-mini',
    capability: 'reasoning',
  });

  assert.equal(selected.provider.name, 'Solo');
  assert.equal(selected.model, 'gpt-4.1-mini');
  assert.equal(selected.reason, 'same_level_fallback');
});

test('review routing filters to vision-capable models when vision is required', () => {
  const { selectReviewerModel } = require('../ai/model-intelligence');
  const providers = [
    {
      id: 1,
      name: 'Mixed',
      enabled: true,
      model: 'gpt-4.1-mini,gemini-2.5-pro',
      vision_models: 'gemini-2.5-pro',
    },
    {
      id: 2,
      name: 'TextOnly',
      enabled: true,
      model: 'claude-4.8-opus',
      vision_models: '',
    },
  ];

  const selected = selectReviewerModel(providers, {
    creatorModel: 'gpt-4.1-mini',
    capability: 'vision',
    requireVision: true,
  });

  assert.equal(selected.provider.name, 'Mixed');
  assert.equal(selected.model, 'gemini-2.5-pro');
});

test('OpenRouter model list can update known ranking metadata without network in core scoring', async () => {
  const { updateModelRankingsFromOpenRouter } = require('../ai/model-intelligence');
  const result = await updateModelRankingsFromOpenRouter({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: 'anthropic/claude-4.9-opus', name: 'Claude 4.9 Opus' },
          { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini' },
        ],
      }),
    }),
  });

  assert.equal(result.source, 'openrouter');
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].id, 'anthropic/claude-4.9-opus');
  assert.ok(result.models[0].scores.general_score > result.models[1].scores.general_score);
});
