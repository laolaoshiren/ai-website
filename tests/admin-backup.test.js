const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db/database');
const { extractZip } = require('../utils/zip-store');
const {
  BACKUP_SECTIONS,
  buildBackupZip,
  inspectBackupInput,
  readBackupInput,
  restoreBackup,
} = require('../utils/admin-backup');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function withDbSnapshot(fn) {
  await db.initDb();
  const target = db.getDb();
  const snapshot = clone(target);
  try {
    return await fn(target);
  } finally {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, snapshot);
    db.saveDb();
  }
}

test('backup zip stores every selected section as an independent JSON file', async () => {
  await withDbSnapshot(async data => {
    data.ai_providers = [{ id: 1, name: 'Text AI', api_key: 'sk-text' }];
    data.image_providers = [{ id: 2, name: 'Image AI', api_key: 'sk-image' }];
    data.ads = [{ id: 3, title: 'Ad' }];
    data.friend_links = [{ id: 4, name: 'Friend', url: 'https://example.com' }];
    data.settings.tavily_api_key = 'tvly-a\ntvly-b';
    data.settings.site_title = 'Backup Site';

    const zip = buildBackupZip(BACKUP_SECTIONS.map(section => section.id));
    const files = extractZip(zip);
    const names = files.map(file => file.name).sort();

    assert.deepEqual(names, [
      'ads.json',
      'ai-providers.json',
      'friend-links.json',
      'manifest.json',
      'site-settings.json',
      'tavily-keys.json',
    ]);

    const parsed = Object.fromEntries(files.map(file => [file.name, JSON.parse(file.data.toString('utf8'))]));
    assert.equal(parsed['ai-providers.json'].ai_providers[0].api_key, 'sk-text');
    assert.equal(parsed['ai-providers.json'].image_providers[0].api_key, 'sk-image');
    assert.equal(parsed['tavily-keys.json'].tavily_api_key, 'tvly-a\ntvly-b');
    assert.equal(parsed['site-settings.json'].settings.site_title, 'Backup Site');
    assert.equal(parsed['site-settings.json'].settings.tavily_api_key, undefined);
    assert.equal(parsed['site-settings.json'].settings._sessions, undefined);
  });
});

test('restore zip only applies checked sections and keeps other data untouched', async () => {
  await withDbSnapshot(async data => {
    data.ads = [{ id: 10, title: 'Exported Ad' }];
    data.friend_links = [{ id: 20, name: 'Exported Friend', url: 'https://exported.example' }];
    const zip = buildBackupZip(['ads', 'friend_links']);

    data.ads = [{ id: 1, title: 'Current Ad' }];
    data.friend_links = [{ id: 2, name: 'Current Friend', url: 'https://current.example' }];

    const restored = restoreBackup('backup.zip', zip, ['ads']);

    assert.deepEqual(restored, ['ads']);
    assert.equal(data.ads[0].title, 'Exported Ad');
    assert.equal(data.friend_links[0].name, 'Current Friend');
    assert.equal(data._counters.ads >= 10, true);
  });
});

test('restore accepts a single section JSON file', async () => {
  await withDbSnapshot(async data => {
    const payload = Buffer.from(JSON.stringify({
      type: 'tavily_keys',
      tavily_api_key: 'tvly-one\ntvly-two',
    }), 'utf8');

    const files = readBackupInput('tavily-keys.json', payload);
    assert.equal(files.length, 1);
    assert.equal(files[0].sectionId, 'tavily_keys');

    const restored = restoreBackup('tavily-keys.json', payload, ['tavily_keys']);
    assert.deepEqual(restored, ['tavily_keys']);
    assert.equal(data.settings.tavily_api_key, 'tvly-one\ntvly-two');
  });
});

test('inspectBackupInput reports only importable sections from the selected file', async () => {
  await withDbSnapshot(async data => {
    data.ads = [{ id: 10, title: 'Exported Ad' }];
    data.settings.tavily_api_key = 'tvly-one\ntvly-two';
    const zip = buildBackupZip(['ads', 'tavily_keys']);

    const detected = inspectBackupInput('backup.zip', zip);

    assert.deepEqual(detected.map(section => section.id), ['ads', 'tavily_keys']);
    assert.deepEqual(detected.map(section => section.filename), ['ads.json', 'tavily-keys.json']);
  });
});
