const test = require('node:test');
const assert = require('node:assert/strict');

test('AI client reviewer routing upgrades review tasks to a stronger available model', () => {
  const { routeReviewProviders } = require('../ai/client');
  const providers = [
    { id: 1, name: 'Writer Provider', enabled: true, model: 'gpt-4.1-mini' },
    { id: 2, name: 'Reviewer Provider', enabled: true, model: 'claude-4.8-opus' },
  ];

  const routed = routeReviewProviders(providers, {
    taskType: 'style_review',
    preferReviewerOverModel: 'gpt-4.1-mini',
    reviewCapability: 'reasoning',
  });

  assert.equal(routed.providers.length, 1);
  assert.equal(routed.providers[0].name, 'Reviewer Provider');
  assert.equal(routed.providers[0].model, 'claude-4.8-opus');
  assert.equal(routed.routing.reason, 'stronger_model');
});

test('AI client reviewer routing does not downgrade to a weaker review model', () => {
  const { routeReviewProviders } = require('../ai/client');
  const providers = [
    { id: 1, name: 'Creator Provider', enabled: true, model: 'claude-4.8-opus' },
    { id: 2, name: 'Weak Reviewer', enabled: true, model: 'gpt-4.1-mini' },
  ];

  const routed = routeReviewProviders(providers, {
    taskType: 'style_review',
    preferReviewerOverModel: 'claude-4.8-opus',
    reviewCapability: 'reasoning',
  });

  assert.equal(routed.providers.length, 1);
  assert.equal(routed.providers[0].name, 'Creator Provider');
  assert.equal(routed.providers[0].model, 'claude-4.8-opus');
  assert.equal(routed.routing.reason, 'same_level_fallback');
});

test('AI client reviewer routing keeps image review on a stronger vision-capable model', () => {
  const { routeReviewProviders } = require('../ai/client');
  const providers = [
    {
      id: 1,
      name: 'Text Strong',
      enabled: true,
      model: 'claude-4.8-opus',
      vision_models: '',
    },
    {
      id: 2,
      name: 'Vision Strong',
      enabled: true,
      model: 'gpt-4.1-mini,gemini-2.5-pro',
      vision_models: 'gemini-2.5-pro',
    },
  ];

  const routed = routeReviewProviders(providers, {
    taskType: 'image_review',
    preferReviewerOverModel: 'gpt-4.1-mini',
    reviewCapability: 'vision',
    requireVision: true,
  });

  assert.equal(routed.providers.length, 1);
  assert.equal(routed.providers[0].name, 'Vision Strong');
  assert.equal(routed.providers[0].model, 'gemini-2.5-pro');
  assert.equal(routed.routing.reason, 'stronger_model');
});
