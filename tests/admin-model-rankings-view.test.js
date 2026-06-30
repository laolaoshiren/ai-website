const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');

test('admin sidebar exposes model ranking management', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'layout-open.ejs'), 'utf8');

  assert.match(sidebar, /\/admin\/model-rankings/);
  assert.match(sidebar, /模型排行/);
});

test('admin model rankings page renders draggable manual ranking form', async () => {
  const rows = [
    {
      key: 'gemini-2.5-pro',
      model: 'gemini-2.5-pro',
      providers: ['Gemini'],
      scores: { general_score: 930, reasoning_score: 945, writing_score: 900, vision_score: 950 },
      manual_rank: 1,
      confidence: 'seeded',
      source: 'manual',
    },
    {
      key: 'claude-4.8-opus',
      model: 'claude-4.8-opus',
      providers: ['Claude'],
      scores: { general_score: 970, reasoning_score: 980, writing_score: 960, vision_score: 925 },
      manual_rank: null,
      confidence: 'seeded',
      source: 'auto',
    },
  ];

  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'model-rankings.ejs'),
    {
      title: '模型排行',
      currentPath: '/admin/model-rankings',
      csrfToken: 'token',
      success: '',
      error: '',
      rows,
      manualRankings: ['gemini-2.5-pro'],
      rankingSnapshot: { updated_at: '2026-06-30 12:00:00', source: 'openrouter' },
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const document = dom.window.document;

  assert.ok(document.querySelector('form[action="/admin/model-rankings/save"]'));
  assert.ok(document.querySelector('[data-model-ranking-list]'));
  assert.equal(document.querySelectorAll('[data-model-ranking-row][draggable="true"]').length, 2);
  assert.equal(document.querySelector('input[name="model_order"]').value, 'gemini-2.5-pro,claude-4.8-opus');
  assert.match(html, /拖动/);
  assert.match(html, /人工排序优先/);
});

test('admin routes include model ranking GET, save, and reset endpoints', () => {
  const adminRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');

  assert.match(adminRoute, /router\.get\('\/model-rankings'/);
  assert.match(adminRoute, /router\.post\('\/model-rankings\/save'/);
  assert.match(adminRoute, /router\.post\('\/model-rankings\/reset'/);
  assert.match(adminRoute, /model_intelligence_manual_rankings/);
});
