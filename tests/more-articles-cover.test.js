const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('more articles payload and client renderer preserve cover images', () => {
  const publicRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'public.js'), 'utf8');
  const homeView = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'home.ejs'), 'utf8');

  assert.match(publicRoute, /cover_image/);
  assert.match(publicRoute, /card_image/);
  assert.match(publicRoute, /image_review_status/);
  assert.match(homeView, /a\.card_image/);
  assert.match(homeView, /card-media/);
});

