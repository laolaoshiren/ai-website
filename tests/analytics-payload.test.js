const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('normalizes analytics payloads from fetch and sendBeacon', () => {
  const { normalizeAnalyticsPayload } = require('../routes/api');

  assert.deepEqual(
    normalizeAnalyticsPayload({
      page_slug: 'plain-slug',
      event_type: 'pageview',
      value: '12.5',
    }),
    {
      page_slug: 'plain-slug',
      event_type: 'pageview',
      value: 12.5,
      referrer: null,
    },
  );

  assert.deepEqual(
    normalizeAnalyticsPayload(JSON.stringify({
      page_slug: '/article/%E7%AB%AF%E4%BE%A7ai',
      event_type: 'scroll_depth',
      value: 86,
      referrer: 'https://example.com',
    })),
    {
      page_slug: '端侧ai',
      event_type: 'scroll_depth',
      value: 86,
      referrer: 'https://example.com',
    },
  );
});

test('article page relies on a single analytics script instead of duplicate inline tracking', () => {
  const articleView = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'article.ejs'), 'utf8');
  const analyticsJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analytics.js'), 'utf8');

  assert.doesNotMatch(articleView, /fetch\('\/api\/analytics'/);
  assert.doesNotMatch(articleView, /sendBeacon\('\/api\/analytics'/);
  assert.match(articleView, /<script src="\/js\/analytics\.js"><\/script>/);
  assert.match(analyticsJs, /new Blob\(\[JSON\.stringify\(data\)\], \{ type: 'application\/json' \}\)/);
  assert.match(analyticsJs, /decodeURIComponent/);
});
