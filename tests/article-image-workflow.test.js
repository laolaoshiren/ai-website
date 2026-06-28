const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function pngBase64(width = 1024, height = 768, payloadSize = 40000) {
  const buffer = Buffer.alloc(payloadSize, 23);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 4, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 2;
  buffer[26] = 0;
  buffer[27] = 0;
  buffer[28] = 0;
  return buffer.toString('base64');
}

function makeTempPublicDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'article-image-'));
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  return { root, publicDir };
}

test('article image workflow stores only reviewed local images', async () => {
  const { generateArticleImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();

  try {
    const result = await generateArticleImage(
      {
        id: 12,
        slug: 'ai-investment-shift',
        title: 'AI investment is moving from foundation models to applied revenue',
        summary: 'Investors are looking for renewal, gross margin and deployment proof.',
        content_md: 'A detailed article about AI investment and enterprise software.',
        category_name: 'Industry',
      },
      {
        config: { image_generation_enabled: '1' },
        providers: [
          {
            id: 1,
            name: 'Agnes',
            base_url: 'https://apihub.agnes-ai.com/v1',
            api_key: 'ok-key',
            model: 'agnes-image-2.1-flash',
            enabled: true,
          },
        ],
        publicDir,
        planner: async () => ({
          needed: true,
          prompt: 'Clean editorial illustration of AI investment moving toward practical software, no text.',
          alt: 'AI investment editorial image',
        }),
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ data: [{ b64_json: pngBase64() }] }),
        }),
      },
    );

    assert.equal(result.skipped, false);
    assert.match(result.coverImage, /^\/generated-images\/articles\/.+\.png$/);
    assert.equal(result.review.status, 'pass');
    assert.equal(result.provider, 'Agnes');
    assert.equal(fs.existsSync(path.join(publicDir, result.coverImage.replace(/^\//, ''))), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('image reviewer rejects tiny or broken images before article metadata is updated', () => {
  const { reviewGeneratedImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, 'tiny.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(1, 1, 1000), 'base64'));

  try {
    const review = reviewGeneratedImage({ filePath, prompt: 'bad tiny image' });

    assert.equal(review.status, 'failed');
    assert.match(review.reason, /dimension|size/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('image reviewer flags prompts that request text-like visual assets', () => {
  const { reviewGeneratedImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, 'valid.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(), 'base64'));

  try {
    const review = reviewGeneratedImage({
      filePath,
      prompt: 'Create a clean business cover with brand marks, captions and signboards.',
    });

    assert.equal(review.status, 'review');
    assert.equal(review.reason, 'prompt_may_request_text');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('semantic image reviewer can reject generated images before metadata is returned', async () => {
  const { generateArticleImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();

  try {
    const result = await generateArticleImage(
      {
        id: 13,
        slug: 'ai-image-review-reject',
        title: 'AI revenue dashboards need cleaner proof',
        summary: 'A substantial article about product metrics and customer renewal evidence.',
        content_md: 'A detailed article about enterprise AI revenue proof and product adoption.',
        category_name: 'Industry',
      },
      {
        config: { image_generation_enabled: '1' },
        providers: [
          {
            id: 2,
            name: 'Agnes',
            base_url: 'https://apihub.agnes-ai.com/v1',
            api_key: 'ok-key',
            model: 'agnes-image-2.1-flash',
            enabled: true,
          },
        ],
        publicDir,
        planner: async () => ({
          needed: true,
          prompt: 'Clean abstract editorial cover, no text.',
          alt: 'AI revenue dashboard editorial image',
        }),
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ data: [{ b64_json: pngBase64() }] }),
        }),
        reviewer: async () => ({
          status: 'failed',
          score: 42,
          reason: 'semantic_rejected: readable text and messy composition',
        }),
      },
    );

    const articleImageDir = path.join(publicDir, 'generated-images', 'articles');
    const remainingFiles = fs.existsSync(articleImageDir) ? fs.readdirSync(articleImageDir) : [];

    assert.equal(result.skipped, true);
    assert.equal(result.review.status, 'failed');
    assert.match(result.review.reason, /semantic_rejected/);
    assert.equal(remainingFiles.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('article image cleanup removes unreferenced old local images and keeps referenced files', () => {
  const { cleanupArticleImages } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'generated-images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const keepPath = path.join(imageDir, 'keep.png');
  const removePath = path.join(imageDir, 'remove.png');
  fs.writeFileSync(keepPath, Buffer.from(pngBase64(), 'base64'));
  fs.writeFileSync(removePath, Buffer.from(pngBase64(), 'base64'));
  const old = new Date(Date.now() - 3 * 86400000);
  fs.utimesSync(keepPath, old, old);
  fs.utimesSync(removePath, old, old);

  try {
    const result = cleanupArticleImages({
      publicDir,
      referencedImages: ['/generated-images/articles/keep.png'],
      olderThanDays: 1,
    });

    assert.equal(fs.existsSync(keepPath), true);
    assert.equal(fs.existsSync(removePath), false);
    assert.equal(result.removed, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fallback article image prompt avoids generic portrait covers', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: 'AI investors are moving from foundation models to applied revenue',
      summary: 'Investors are following renewal and margin proof.',
      category_name: 'Industry',
    },
    { skipAIPlanner: true },
  );

  assert.match(plan.prompt, /no people/i);
  assert.match(plan.prompt, /object-only|abstract/i);
  assert.match(plan.prompt, /capital flows|market-map|product/i);
  assert.doesNotMatch(plan.prompt, /\binvestors?\b/i);
  assert.doesNotMatch(plan.prompt, /\bSaaS\b|product cards|sealed documents|readable labels/i);
  assert.doesNotMatch(plan.prompt, /portrait|scientist|laboratory|lab coat/i);
});

test('unsafe planner prompts are rewritten into non-human editorial covers', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: 'SaaS founders chase AI renewal growth',
      summary: 'Investors and founders are looking at contract renewal proof.',
      category_name: 'AI business',
    },
    {
      planner: async () => ({
        needed: true,
        alt: 'AI business image',
        prompt: 'A heroic close-up portrait of a founder in a laboratory wearing a lab coat, dashboard text in the background',
      }),
    },
  );

  assert.match(plan.prompt, /object-only/i);
  assert.match(plan.prompt, /no people/i);
  assert.match(plan.prompt, /capital flows|renewal loops|product/i);
  assert.doesNotMatch(plan.prompt, /\bSaaS\b|product cards|sealed documents|readable labels/i);
  assert.doesNotMatch(plan.prompt, /heroic|close-up|portrait|founder|laboratory|lab coat|dashboard text/i);
});
