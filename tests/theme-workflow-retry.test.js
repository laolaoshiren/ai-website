const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../db/database');
const { refreshConfig } = require('../config');

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

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'theme-workflow-retry-'));
}

function baseManifest(name = 'Theme') {
  return {
    name,
    version: '1.0.0',
    site_type: 'magazine',
    templates: ['home', 'article', 'category', 'archive', 'search', '404'],
    partials: ['header', 'footer', 'article-card', 'pagination'],
    assets: ['assets/theme.css'],
  };
}

function requiredPages(home, css) {
  return {
    'templates/home.ejs': home,
    'templates/article.ejs': '<html><head><meta name="description" content="<%= post.summary || site.description %>"></head><body><article><h1><%= post.title %></h1><%- post.content_html || "" %></article></body></html>',
    'templates/category.ejs': '<html><body><main><h1><%= category.name %></h1></main></body></html>',
    'templates/archive.ejs': '<html><body><main><h1>Archive</h1></main></body></html>',
    'templates/search.ejs': '<html><body><main><h1>Search</h1></main></body></html>',
    'templates/404.ejs': '<html><body><main><h1>404</h1></main></body></html>',
    'partials/header.ejs': '<div></div>',
    'partials/footer.ejs': '<footer></footer>',
    'partials/article-card.ejs': '<article><%= post.title %></article>',
    'partials/pagination.ejs': '<nav></nav>',
    'assets/theme.css': css,
  };
}

test('theme workflow retries with reviewer feedback until a differentiated preview passes', async () => {
  const rootDir = makeTempRoot();
  const current = db.getDb();
  current.ai_themes = [];
  current.settings.site_title = 'AI 纪元';
  current.settings.site_description = 'AI news';
  current.settings.site_type = 'magazine';
  refreshConfig();

  let calls = 0;
  const result = await require('../ai/theme-workflow').generateAndReviewTheme({
    site_type: 'magazine',
    instruction: 'Make a third-party magazine skin.',
    maxAttempts: 2,
    themeEngineOptions: { rootDir },
    callAIForJSON: async (messages) => {
      calls += 1;
      const promptText = messages.map(message => message.content).join('\n');
      if (calls === 1) {
        return {
          data: {
            manifest: baseManifest('Too Similar'),
            files: requiredPages(
              '<html><head><title><%= site.title %></title><link rel="stylesheet" href="<%= themeAssetUrl %>"></head><body><header class="terminal-header"><nav class="command-nav"><ul class="nav-links"><% site.categories.forEach(function(category){ %><li><%= category.name %></li><% }) %></ul></nav></header><main><aside class="hotspot-sidebar">热度排行</aside><section class="feed-grid"><% posts.slice(0, 6).forEach(function(post){ %><article class="feed-item"><%= post.title %></article><% }) %></section></main></body></html>',
              ':root{--bg-dark:#0a0a0f;--bg-card:#1a1a24;--primary-glow:#00f0ff}.nav-links{display:flex}.feed-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.feed-item{background:var(--bg-card);border:1px solid #123;border-left:3px solid var(--primary-glow)}body{background:var(--bg-dark);color:white}',
            ),
          },
        };
      }
      assert.match(promptText, /reviewer|builtin-like layout fingerprint|failed review/i);
      return {
        data: {
          manifest: baseManifest('Paper Index'),
          files: requiredPages(
            '<html><head><title><%= site.title %></title><link rel="stylesheet" href="<%= themeAssetUrl %>"></head><body class="paper-index"><main class="cover-sheet"><section class="masthead"><p>AI Review</p><h1><%= site.title %></h1></section><section class="issue-columns"><% posts.forEach(function(post){ %><article class="toc-row"><a href="/article/<%= post.slug %>"><%= post.title %></a></article><% }) %></section></main></body></html>',
            'body{margin:0;background:#f6f0e6;color:#191715;font-family:Georgia,serif}.cover-sheet{min-height:100vh;padding:42px;display:flex;gap:36px}.masthead{writing-mode:vertical-rl;border-left:3px solid #191715;padding-left:20px}.issue-columns{columns:2 260px;column-gap:42px}.toc-row{break-inside:avoid;border-top:1px solid #191715;padding:16px 0}@media(max-width:720px){.cover-sheet{display:block;padding:24px}.masthead{writing-mode:horizontal-tb;border-left:0;border-bottom:3px solid #191715}.issue-columns{columns:1}}',
          ),
          design_note: 'Light paper index layout.',
        },
      };
    },
  });

  const themes = db.listAIThemes();
  assert.equal(calls, 2);
  assert.equal(result.report.pass, true);
  assert.equal(result.status, 'preview');
  assert.equal(themes.length, 2);
  assert.equal(themes.filter(theme => theme.status === 'failed').length, 1);
  assert.equal(themes.filter(theme => theme.status === 'preview').length, 1);
});
