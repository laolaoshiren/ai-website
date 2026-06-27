const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAutonomySnapshot, planAutonomyActions } = require('../ai/autonomy-director');

test('prioritizes article quality when many planned pages are blocked by the style gate', () => {
  const snapshot = buildAutonomySnapshot({
    pages: [
      { status: 'planned', last_error: 'style_check_failed' },
      { status: 'planned', last_error: 'style_check_failed' },
      { status: 'planned', last_error: 'style_check_failed' },
      { status: 'published' },
    ],
    ai_providers: [],
    analytics: [],
    agent_logs: [],
  });

  const actions = planAutonomyActions(snapshot);

  assert.equal(actions[0].type, 'article_quality');
  assert.equal(actions[0].taskType, 'generate_content');
  assert.match(actions[0].reason, /style_check_failed/);
});

test('flags provider stability when active providers have high error rates', () => {
  const snapshot = buildAutonomySnapshot({
    pages: [],
    ai_providers: [
      { name: 'A', enabled: true, request_count: 20, error_count: 15 },
      { name: 'B', enabled: true, request_count: 20, error_count: 1 },
    ],
    analytics: [],
    agent_logs: [],
  });

  const actions = planAutonomyActions(snapshot);

  assert.equal(actions.some(action => action.type === 'provider_health'), true);
});

test('recommends retention work when reading depth is weak', () => {
  const snapshot = buildAutonomySnapshot({
    pages: [{ status: 'published' }, { status: 'published' }],
    ai_providers: [],
    analytics: [
      { event_type: 'pageview' },
      { event_type: 'time_on_page', value: 12 },
      { event_type: 'scroll_depth', value: 22 },
    ],
    agent_logs: [],
  });

  const actions = planAutonomyActions(snapshot);

  assert.equal(actions.some(action => action.type === 'retention'), true);
});
