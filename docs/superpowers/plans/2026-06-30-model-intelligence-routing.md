# Model Intelligence Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a model capability ranking and reviewer routing layer so review agents prefer stronger available models than the models used for writing or image planning.

**Architecture:** Add a focused `ai/model-intelligence.js` module with seeded scores, name-based inference, OpenRouter update normalization, and provider/model selection helpers. Extend `ai/client.js` to route review tasks through higher-ranked available models when possible, while falling back safely if only same-level models exist. Add a scheduler task for periodic ranking updates and tests for ranking, routing, and schedule registration.

**Tech Stack:** Node.js CommonJS, Express scheduler, JSON DB settings, `node:test`.

---

### Task 1: Model Intelligence Module

**Files:**
- Create: `ai/model-intelligence.js`
- Test: `tests/model-intelligence.test.js`

- [ ] **Step 1: Write failing tests**

Add tests for seeded model comparison, future version inference, and reviewer candidate selection:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('scores known and future same-family models in the expected order', () => {
  const { scoreModel, compareModels } = require('../ai/model-intelligence');
  assert.ok(scoreModel('claude-4.9-opus').general_score > scoreModel('claude-4.8-opus').general_score);
  assert.ok(scoreModel('claude-4.8-opus').general_score > scoreModel('gpt-4.1-mini').general_score);
  assert.equal(compareModels('claude-4.9-opus', 'claude-4.8-opus') > 0, true);
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
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/model-intelligence.test.js`

Expected: FAIL because `ai/model-intelligence.js` does not exist.

- [ ] **Step 3: Implement module**

Implement:

```js
scoreModel(modelName)
compareModels(a, b, capability)
expandProviderModelCandidates(providers, options)
selectReviewerModel(providers, context)
updateModelRankingsFromOpenRouter(options)
```

Use seeded model families and heuristic version parsing. Do not require network for core scoring.

- [ ] **Step 4: Verify module tests pass**

Run: `node --test tests/model-intelligence.test.js`

Expected: PASS.

### Task 2: Review Routing In AI Client

**Files:**
- Modify: `ai/client.js`
- Test: `tests/model-review-routing.test.js`

- [ ] **Step 1: Write failing routing tests**

Test that `callAIForJSON` can request `preferReviewerOverModel`, that review tasks pick higher-ranked models, and that vision review stays restricted to vision-capable models.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/model-review-routing.test.js`

Expected: FAIL because client does not support reviewer routing.

- [ ] **Step 3: Implement client hooks**

Add a small provider/model override path:

```js
if (options.preferReviewerOverModel) {
  const selected = selectReviewerModel(providers, {
    creatorModel: options.preferReviewerOverModel,
    capability: options.reviewCapability || (options.requireVision ? 'vision' : 'reasoning'),
    requireVision: options.requireVision,
  });
  if (selected) providers = [{ ...selected.provider, model: selected.model }];
}
```

Preserve existing provider health ranking and fallback behavior.

- [ ] **Step 4: Wire review callers**

Pass `preferReviewerOverModel` where creator model is known:

- `ai/humanized-writing.js`: style/humanization reviewer can use `context.creatorModel`.
- `ai/article-image.js`: image semantic review can use `article.image_planner_model` when available, otherwise still prefer the strongest vision model.
- `ai/writer.js`: pass writer `model` into publication preparation context and image review context.

- [ ] **Step 5: Verify tests pass**

Run: `node --test tests/model-review-routing.test.js tests/vision-model-routing.test.js tests/writer-style-gate.test.js tests/article-image-workflow.test.js`

Expected: PASS.

### Task 3: Ranking Update Agent

**Files:**
- Modify: `db/database.js`
- Modify: `scheduler/index.js`
- Test: `tests/model-ranker-schedule.test.js`

- [ ] **Step 1: Write failing schedule tests**

Assert default schedules include `model_rank_update`, and scheduler maps it to a Chinese-named technician/model rank task.

- [ ] **Step 2: Implement task**

Add default schedule:

```js
{ id: 11, task_type: 'model_rank_update', cron_expr: '0 5 * * 0', description: '每周日 5:00 更新模型能力排行', enabled: 1, last_run: null }
```

Add scheduler case that calls `updateModelRankingsFromOpenRouter()` and logs count/source. Persist result in settings as JSON under `model_intelligence_rankings`.

- [ ] **Step 3: Verify schedule tests pass**

Run: `node --test tests/model-ranker-schedule.test.js`

Expected: PASS.

### Task 4: Full Verification And Deployment

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test tests/model-intelligence.test.js tests/model-review-routing.test.js tests/model-ranker-schedule.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Syntax checks**

Run:

```bash
node --check ai/model-intelligence.js
node --check ai/client.js
node --check scheduler/index.js
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit, merge, push, wait for CI, deploy**

Follow project workflow:

```bash
git add .
git commit -m "feat: route reviews through stronger models"
git switch master
git pull --ff-only origin master
git merge --no-ff codex/model-intelligence-routing -m "merge: route reviews through stronger models"
git push origin master
gh run watch <run-id> --exit-status
ssh tx "cd /opt/ai-website && docker compose pull && docker compose up -d --force-recreate && docker compose ps"
```

Expected: CI success, online container healthy, `/api/health` returns 200.

