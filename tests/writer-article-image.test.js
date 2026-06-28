const test = require('node:test');
const assert = require('node:assert/strict');

test('writer stores reviewed article image metadata only when generation passes', () => {
  const { buildArticleImageUpdates } = require('../ai/writer');

  const updates = buildArticleImageUpdates({
    skipped: false,
    coverImage: '/images/articles/example.png',
    coverThumbnail: '/images/articles/example-thumb.png',
    imageAlt: 'Article cover',
    imagePrompt: 'Clean editorial image, no text.',
    imageReason: 'visual improves scanning',
    review: { status: 'pass', reason: 'technical_review_passed' },
    provider: 'Agnes',
    model: 'agnes-image-2.1-flash',
  });

  assert.equal(updates.cover_image, '/images/articles/example.png');
  assert.equal(updates.cover_thumbnail, '/images/articles/example-thumb.png');
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

test('writer logs article image designer success before reviewer success when image passes', () => {
  const { logArticleImageOutcome } = require('../ai/writer');
  const calls = [];

  logArticleImageOutcome(
    (...args) => calls.push(args),
    { title: 'AI revenue proof needs better product evidence' },
    {
      skipped: false,
      provider: 'Agnes Image',
      model: 'agnes-image-2.1-flash',
      review: { status: 'pass', reason: 'semantic_review_passed' },
    },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => [call[0], call[2]]), [
    ['image_designer', 'success'],
    ['image_reviewer', 'success'],
  ]);
  assert.match(calls[0][3], /生成完成/);
  assert.equal(calls[0][4].provider, 'Agnes Image');
  assert.equal(calls[0][4].model, 'agnes-image-2.1-flash');
});

test('writer logs article image reviewer failure without leaving designer stuck running', () => {
  const { logArticleImageOutcome } = require('../ai/writer');
  const calls = [];

  logArticleImageOutcome(
    (...args) => calls.push(args),
    { title: 'Sora 3 video generation risk' },
    {
      skipped: true,
      reason: 'image_review_failed',
      provider: 'Agnes Image',
      model: 'agnes-image-2.1-flash',
    },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => [call[0], call[2]]), [
    ['image_designer', 'success'],
    ['image_reviewer', 'failed'],
  ]);
  assert.match(calls[1][3], /审核未通过/);
});
