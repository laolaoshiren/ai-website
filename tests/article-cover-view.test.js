const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('article detail page renders reviewed cover images above the body', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'article.ejs'), 'utf8');

  assert.match(template, /article-cover/);
  assert.match(template, /article\.cover_image/);
  assert.match(template, /image_review_status/);
});

