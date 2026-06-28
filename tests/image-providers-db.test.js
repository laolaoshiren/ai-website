const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db/database');

let snapshot;

test.before(async () => {
  await db.initDb();
  snapshot = JSON.parse(JSON.stringify(db.getDb()));
});

test.after(() => {
  const current = db.getDb();
  for (const key of Object.keys(current)) delete current[key];
  Object.assign(current, snapshot);
  db.saveDb();
});

function resetImageProviders() {
  const current = db.getDb();
  current.image_providers = [];
  current._counters.image_providers = 0;
}

test('image providers are stored separately from text AI providers', () => {
  resetImageProviders();
  const textProviderCount = db.getAIProviders().length;

  const id = db.addImageProvider({
    name: 'Agnes',
    base_url: 'https://apihub.agnes-ai.com/v1',
    api_key: 'sk-a\nsk-b',
    model: 'agnes-image-2.1-flash',
  });

  const providers = db.getImageProviders();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, id);
  assert.equal(providers[0].request_count, 0);
  assert.equal(db.getAIProviders().length, textProviderCount);
});

test('image provider usage and auth failures do not mutate text provider stats', () => {
  resetImageProviders();
  const id = db.addImageProvider({
    name: 'Agnes',
    base_url: 'https://apihub.agnes-ai.com/v1',
    api_key: 'sk-a',
    model: 'agnes-image-2.1-flash',
  });

  db.incrementImageProviderUsage(id, false);
  db.updateImageProvider(id, { enabled: false, disabled_reason: 'auth_error' });

  const provider = db.getImageProviders()[0];
  assert.equal(provider.request_count, 1);
  assert.equal(provider.error_count, 1);
  assert.equal(provider.enabled, false);
  assert.equal(provider.disabled_reason, 'auth_error');
});

