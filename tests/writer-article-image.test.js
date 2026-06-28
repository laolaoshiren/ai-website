const test = require('node:test');
const assert = require('node:assert/strict');

test('writer stores reviewed article image metadata only when generation passes', () => {
  const { buildArticleImageUpdates } = require('../ai/writer');

  const updates = buildArticleImageUpdates({
    skipped: false,
    coverImage: '/images/articles/example.png',
    imageAlt: 'Article cover',
    imagePrompt: 'Clean editorial image, no text.',
    imageReason: 'visual improves scanning',
    review: { status: 'pass', reason: 'technical_review_passed' },
    provider: 'Agnes',
    model: 'agnes-image-2.1-flash',
  });

  assert.equal(updates.cover_image, '/images/articles/example.png');
  assert.equal(updates.image_review_status, 'pass');
  assert.equal(updates.image_provider, 'Agnes');
  assert.equal(updates.image_model, 'agnes-image-2.1-flash');
  assert.ok(updates.image_generated_at);
});

test('writer leaves article image fields untouched when image generation is skipped', () => {
  const { buildArticleImageUpdates } = require('../ai/writer');

  assert.deepEqual(buildArticleImageUpdates({ skipped: true, reason: 'sampled_out' }), {});
  assert.deepEqual(buildArticleImageUpdates(null), {});
});

