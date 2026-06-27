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

function resetThemes() {
  const current = db.getDb();
  current.ai_themes = [];
  current._counters.ai_themes = 0;
  current.settings.site_type = 'blog';
  current.settings.ai_theme_enabled = '1';
  current.settings.theme_mode = 'builtin';
  current.settings.active_theme_id = '';
  current.settings.ai_theme_locked = '0';
}

test('database initializes additive AI theme settings and counters', () => {
  const current = db.getDb();

  assert.ok(Array.isArray(current.ai_themes));
  assert.equal(typeof current._counters.ai_themes, 'number');
  assert.ok(['news', 'blog', 'cms', 'magazine', 'knowledge_base'].includes(current.settings.site_type));
  assert.ok(['0', '1'].includes(current.settings.ai_theme_enabled));
  assert.ok(['builtin', 'ai_active'].includes(current.settings.theme_mode));
});

test('theme records can be generated, reviewed, published, locked, and rolled back', () => {
  resetThemes();

  const id = db.addAIThemeRecord({
    theme_id: 'theme-a',
    name: 'Theme A',
    site_type: 'blog',
    status: 'preview',
    score: 91,
    review_report: { pass: true, issues: [] },
    ai_meta: { provider: 'p1', model: 'm1' },
  });

  assert.equal(id, 1);
  assert.equal(db.getAIThemeByThemeId('theme-a').status, 'preview');

  db.publishAITheme('theme-a', { score: 91, review_report: { pass: true, issues: [] } });

  const published = db.getAIThemeByThemeId('theme-a');
  assert.equal(published.status, 'published');
  assert.equal(published.locked, true);
  assert.equal(db.getSetting('theme_mode'), 'ai_active');
  assert.equal(db.getSetting('active_theme_id'), 'theme-a');
  assert.equal(db.getSetting('ai_theme_locked'), '1');

  db.rollbackToBuiltinTheme();

  assert.equal(db.getSetting('theme_mode'), 'builtin');
  assert.equal(db.getSetting('active_theme_id'), '');
  assert.equal(db.getSetting('ai_theme_locked'), '0');
});
