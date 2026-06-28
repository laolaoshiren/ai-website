const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('article cards render the full published timestamp to seconds', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'partials', 'article-card.ejs'),
    {
      article: {
        title: 'Timing test',
        slug: 'timing-test',
        summary: 'A short summary.',
        category_name: 'AI',
        category_slug: 'ai',
        published_at: '2026-06-29 01:37:31',
        image_review_status: null,
      },
    },
  );

  assert.match(html, /2026-06-29 01:37:31/);
  assert.doesNotMatch(html, /今天|昨天|天前|周前/);
});

test('frontend templates do not truncate article published timestamps', () => {
  const articleView = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'article.ejs'), 'utf8');
  const archiveView = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'archive.ejs'), 'utf8');
  const homeView = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'home.ejs'), 'utf8');

  assert.doesNotMatch(articleView, /published_at\.split\(' '\)\[0\]/);
  assert.match(articleView, /article\.published_at/);

  assert.doesNotMatch(archiveView, /published_at[^%]*slice\(8,\s*10\)/);
  assert.match(archiveView, /a\.published_at/);

  assert.doesNotMatch(homeView, /timeLabel|天前|周前|今天|昨天/);
  assert.match(homeView, /a\.published_at/);
});
