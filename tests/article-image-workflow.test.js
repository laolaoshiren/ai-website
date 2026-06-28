const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

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

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcTable = pngChunk.crcTable || (pngChunk.crcTable = Array.from({ length: 256 }, (_, index) => {
    let c = index;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBuffer, data])) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function realPngBuffer(width = 1024, height = 768) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      raw[offset] = (x + y) % 256;
      raw[offset + 1] = (x * 3) % 256;
      raw[offset + 2] = (y * 5) % 256;
      raw[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
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

test('article image workflow stores a generated thumbnail for list pages', async () => {
  const { generateArticleImage, readImageDimensions } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();

  try {
    const result = await generateArticleImage(
      {
        id: 22,
        slug: 'restaurant-menu-profit',
        title: 'Restaurant menu engineering turns seasonal dishes into higher margins',
        summary: 'A practical food business story about menu layout and kitchen timing.',
        content_md: 'A detailed article about food, kitchen workflows and seasonal dishes.',
        category_name: 'Food',
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
        semanticReview: false,
        planner: async () => ({
          needed: true,
          prompt: 'Premium editorial image of seasonal restaurant dishes and a calm kitchen pass, no text.',
          alt: 'Restaurant menu editorial image',
        }),
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ data: [{ b64_json: realPngBuffer().toString('base64') }] }),
        }),
      },
    );

    assert.equal(result.skipped, false);
    assert.match(result.coverImage, /^\/generated-images\/articles\/.+\.png$/);
    assert.match(result.coverThumbnail, /^\/generated-images\/thumbnails\/articles\/.+\.png$/);
    const thumbnailPath = path.join(publicDir, result.coverThumbnail.replace(/^\//, ''));
    assert.equal(fs.existsSync(thumbnailPath), true);
    const dimensions = readImageDimensions(fs.readFileSync(thumbnailPath));
    assert.ok(dimensions.width <= 480);
    assert.ok(dimensions.height <= 320);
    assert.ok(fs.statSync(thumbnailPath).size < fs.statSync(path.join(publicDir, result.coverImage.replace(/^\//, ''))).size);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('article image view preparation hides missing covers and prefers thumbnails for cards', () => {
  const { prepareArticleImageForView } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const articleDir = path.join(publicDir, 'generated-images', 'articles');
  fs.mkdirSync(articleDir, { recursive: true });
  fs.writeFileSync(path.join(articleDir, 'keep.png'), realPngBuffer());

  try {
    const missing = prepareArticleImageForView(
      { title: 'Missing cover', cover_image: '/generated-images/articles/missing.png', image_review_status: 'pass' },
      { publicDir },
    );
    assert.equal(missing.cover_image, null);
    assert.equal(missing.card_image, null);
    assert.equal(missing.image_review_status, null);

    const present = prepareArticleImageForView(
      { title: 'Present cover', cover_image: '/generated-images/articles/keep.png', image_review_status: 'pass' },
      { publicDir },
    );
    assert.equal(present.cover_image, '/generated-images/articles/keep.png');
    assert.match(present.cover_thumbnail, /^\/generated-images\/thumbnails\/articles\/keep-thumb\.png$/);
    assert.equal(present.card_image, present.cover_thumbnail);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('article image metadata repair clears missing covers and backfills thumbnails', () => {
  const { repairArticleImageRecords } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const articleDir = path.join(publicDir, 'generated-images', 'articles');
  fs.mkdirSync(articleDir, { recursive: true });
  fs.writeFileSync(path.join(articleDir, 'keep.png'), realPngBuffer());
  let saved = false;
  const data = {
    pages: [
      {
        id: 1,
        cover_image: '/generated-images/articles/missing.png',
        cover_thumbnail: null,
        image_review_status: 'pass',
      },
      {
        id: 2,
        cover_image: '/generated-images/articles/keep.png',
        cover_thumbnail: null,
        image_review_status: 'pass',
      },
    ],
  };

  try {
    const result = repairArticleImageRecords({
      publicDir,
      db: {
        getDb: () => data,
        saveDb: () => { saved = true; },
      },
    });

    assert.equal(result.missingCleared, 1);
    assert.equal(result.thumbnailsBackfilled, 1);
    assert.equal(data.pages[0].cover_image, null);
    assert.equal(data.pages[0].image_review_status, null);
    assert.match(data.pages[1].cover_thumbnail, /^\/generated-images\/thumbnails\/articles\/keep-thumb\.png$/);
    assert.equal(saved, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('image reviewer allows prompts that forbid text-like visual assets', () => {
  const { reviewGeneratedImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, 'safe-valid.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(), 'base64'));

  try {
    const review = reviewGeneratedImage({
      filePath,
      prompt: 'Editorial cover image. Hard correction: no readable text, no pseudo text, no UI labels, no numbers, no logos, no watermarks. For documents, charts, signs or any screen, make text-bearing surfaces blank, turned away, out of focus, or abstract non-legible.',
    });

    assert.equal(review.status, 'pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('image reviewer allows blank-surface wording even when no-text wording is truncated away', () => {
  const { reviewGeneratedImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, 'blank-surface-valid.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(), 'base64'));

  try {
    const review = reviewGeneratedImage({
      filePath,
      prompt: 'If the chosen subject includes phones, computers, documents, books, menus, signs, labels, dashboards, packaging, charts or any screen, keep text-bearing surfaces blank, turned away, out of focus, cropped away, or represented only by abstract non-legible shapes.',
    });

    assert.equal(review.status, 'pass');
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

test('semantic review fails when the reviewer reports garbled text despite pass status', async () => {
  const { reviewArticleImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'generated-images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, 'phone-screen.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(), 'base64'));

  try {
    const review = await reviewArticleImage(
      {
        filePath,
        prompt: 'Editorial photo of a phone used for AI performance testing, no text, no logos.',
        article: {
          title: 'iPhone local AI tests hit thermal limits',
          summary: 'A test article about phone performance, heat and local models.',
          category_name: 'Technology',
        },
      },
      {
        reviewer: async () => ({
          status: 'pass',
          score: 4,
          reason: 'Contextually relevant, but the phone screen contains garbled text and UI labels.',
          issues: ['garbled text on screen'],
        }),
      },
    );

    assert.equal(review.status, 'failed');
    assert.match(review.reason, /garbled text/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('semantic review does not reject negated generic-template wording', async () => {
  const { reviewArticleImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'generated-images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, 'food-cover.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(), 'base64'));

  try {
    const review = await reviewArticleImage(
      {
        filePath,
        prompt: 'Warm bowl of miso ramen on a dinner table, no text, no logos.',
        article: {
          title: 'Winter miso ramen guide',
          summary: 'A food article about broth, noodles and toppings.',
          category_name: 'Food',
        },
      },
      {
        reviewer: async () => ({
          status: 'pass',
          score: 82,
          reason: 'Relevant, visually coherent, not 99% generic, and has no obvious gibberish text or logos.',
          issues: [],
        }),
      },
    );

    assert.equal(review.status, 'pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('semantic review accepts 10-point scores when the review text is positive', async () => {
  const { reviewArticleImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  const imageDir = path.join(publicDir, 'generated-images', 'articles');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, 'positive-review.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(), 'base64'));

  try {
    const review = await reviewArticleImage(
      {
        filePath,
        prompt: 'Editorial still life of a smartphone back side and translucent security shield, no text, no logos.',
        article: {
          title: 'Mobile AI integration safeguards',
          summary: 'A technology article about privacy and app integration.',
          category_name: 'Technology',
        },
      },
      {
        reviewer: async () => ({
          status: 'failed',
          score: 8,
          reason: 'Image is relevant, coherent, has no readable text, logos or watermarks, and matches the article theme.',
          issues: [],
        }),
      },
    );

    assert.equal(review.status, 'pass');
    assert.equal(review.semantic_score, 80);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('article image generation retries with stricter prompt after review failure', async () => {
  const { generateArticleImage } = require('../ai/article-image');
  const { root, publicDir } = makeTempPublicDir();
  let imageAttempts = 0;
  let reviewAttempts = 0;
  const prompts = [];

  try {
    const result = await generateArticleImage(
      {
        id: 14,
        slug: 'iphone-thermal-ai-test',
        title: 'iPhone local AI tests hit thermal limits',
        summary: 'A substantial article about phone performance, heat and local model latency.',
        content_md: 'A detailed article about device-side AI inference, thermal throttling and benchmark tradeoffs.',
        category_name: 'Technology',
      },
      {
        config: { image_generation_enabled: '1' },
        providers: [
          {
            id: 3,
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
          prompt: 'Editorial phone performance test scene with a device and lab table, no text.',
          alt: 'Phone performance test cover',
        }),
        fetchImpl: async (url, init) => {
          imageAttempts += 1;
          prompts.push(JSON.parse(init.body).prompt);
          return {
            ok: true,
            json: async () => ({ data: [{ b64_json: pngBase64(1024 + imageAttempts, 768) }] }),
          };
        },
        reviewer: async () => {
          reviewAttempts += 1;
          if (reviewAttempts === 1) {
            return {
              status: 'failed',
              score: 20,
              reason: 'The image contains garbled text on a visible screen.',
              issues: ['garbled text'],
            };
          }
          return { status: 'pass', score: 82, reason: 'Relevant and coherent', issues: [] };
        },
      },
    );

    const articleImageDir = path.join(publicDir, 'generated-images', 'articles');
    const remainingFiles = fs.existsSync(articleImageDir) ? fs.readdirSync(articleImageDir) : [];

    assert.equal(result.skipped, false);
    assert.equal(imageAttempts, 2);
    assert.equal(reviewAttempts, 2);
    assert.match(prompts[1].slice(0, 260), /previous attempt failed/i);
    assert.match(prompts[1], /previous attempt failed/i);
    assert.match(prompts[1], /blank|turned away|out of focus|non-legible/i);
    assert.equal(remainingFiles.length, 1);
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

test('fallback article image prompts are article-specific instead of one fixed visual template', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const businessPlan = await planArticleImage(
    {
      slug: 'ai-investment-shift',
      title: 'AI investors are moving from foundation models to applied revenue',
      summary: 'Investors are following renewal and margin proof.',
      category_name: 'Industry',
    },
    { skipAIPlanner: true },
  );
  const videoPlan = await planArticleImage(
    {
      slug: 'sora-industrial-pipeline',
      title: 'Sora 3 pushes video generation into industrial production workflows',
      summary: 'Studios are testing review pipelines, shot consistency and delivery risk.',
      category_name: 'Video AI',
    },
    { skipAIPlanner: true },
  );

  for (const prompt of [businessPlan.prompt, videoPlan.prompt]) {
    assert.match(prompt, /Editorial cover image/i);
    assert.match(prompt, /Article focus:/i);
    assert.match(prompt, /Primary visual brief:/i);
    assert.match(prompt, /Let the article decide the subject/i);
    assert.doesNotMatch(prompt, /luminous blue-white glass core/i);
    assert.doesNotMatch(prompt, /circular ring/i);
    assert.doesNotMatch(prompt, /blank white cubes/i);
    assert.doesNotMatch(prompt, /data-flow ribbons/i);
  }
  assert.match(businessPlan.prompt, /applied revenue|renewal|margin proof/i);
  assert.match(videoPlan.prompt, /Sora 3|video generation|production workflows/i);
  assert.notEqual(businessPlan.prompt, videoPlan.prompt);
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

  assert.match(plan.prompt, /Editorial cover image/i);
  assert.match(plan.prompt, /Article focus:/i);
  assert.match(plan.prompt, /renewal growth|contract renewal proof|founders|subscription software/i);
  assert.doesNotMatch(plan.prompt, /luminous blue-white glass core/i);
  assert.doesNotMatch(plan.prompt, /circular ring/i);
  assert.doesNotMatch(plan.prompt, /blank white cubes/i);
  assert.doesNotMatch(plan.prompt, /data-flow ribbons/i);
  assert.doesNotMatch(plan.prompt, /heroic close-up portrait|laboratory wearing a lab coat|dashboard text/i);
});

test('safe planner prompts keep article-specific visual details', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: 'GPU supply chains move from raw compute to verified delivery capacity',
      summary: 'Cloud vendors are comparing lead times, cooling limits and shipment evidence.',
      category_name: 'Infrastructure',
    },
    {
      planner: async () => ({
        needed: true,
        alt: 'GPU supply chain editorial cover',
        prompt: 'Premium editorial still life of matte GPU modules, cooling fins, shipping crates and cable paths arranged like a delivery capacity map, no text, no logos.',
      }),
    },
  );

  assert.match(plan.prompt, /GPU modules|cooling fins|shipping crates|delivery capacity map/i);
  assert.doesNotMatch(plan.prompt, /luminous blue-white glass core|circular ring|blank white cubes/i);
  assert.doesNotMatch(plan.prompt, /portrait of|laboratory/i);
});

test('safe planner prompts can keep contextual people when relevant', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: 'Kyoto autumn walking route: temple paths, tea shops and evening lanterns',
      summary: 'A travel guide about a quiet walking route, local shops and seasonal atmosphere.',
      category_name: 'Travel',
    },
    {
      planner: async () => ({
        needed: true,
        alt: 'Kyoto autumn walking route cover',
        visual_angle: 'Use a warm travel scene rather than a generic landscape.',
        prompt: 'Golden-hour Kyoto lane with maple leaves, temple steps, tea shop doorway and a few travelers seen from behind in the distance, no readable signs, no logos.',
      }),
    },
  );

  assert.match(plan.prompt, /Kyoto lane|maple leaves|temple steps|tea shop|travelers seen from behind/i);
  assert.match(plan.prompt, /People are allowed/i);
  assert.doesNotMatch(plan.prompt, /headshot|selfie/i);
});

test('english planner briefs keep raw Chinese article text out of the image prompt', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: '生成式AI版权新规满月：素材库厂商的商业模式重构实录',
      summary: '文章讨论版权授权、训练数据合规、素材库商业模式和客户合同变化。',
      category_name: '前沿研究',
    },
    {
      planner: async () => ({
        needed: true,
        alt: 'AI copyright regulation stock library cover',
        visual_angle: 'Use a licensing and media-library business scene, not food ingredients.',
        prompt: 'Premium editorial still life of blank licensing contracts, contact sheets of generic stock photo thumbnails, camera lens, archive boxes and approval stamps with all paper surfaces blank, no readable text, no logos.',
      }),
    },
  );

  assert.match(plan.prompt, /licensing contracts|stock photo thumbnails|camera lens|archive boxes/i);
  assert.match(plan.prompt, /English visual brief|source of truth/i);
  assert.doesNotMatch(plan.prompt, /素材库|版权新规|生成式AI|商业模式重构|前沿研究/);
});

test('unsafe English planner briefs are sanitized instead of falling back to raw Chinese context', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: 'Sora关停后，视频生成模型开始较真“物理课”',
      summary: '文章讨论视频生成模型的物理一致性、水杯消失和车辆转弯穿帮。',
      category_name: '前沿研究',
    },
    {
      planner: async () => ({
        needed: true,
        alt: 'AI video physics cover',
        visual_angle: 'Show physical consistency testing without rendering any model name.',
        prompt: 'Split-screen editorial scene: a cup fading near a person in the left panel, a car turning with realistic shadows in the right panel, no text, no logos, no close-up hands.',
      }),
    },
  );

  assert.match(plan.prompt, /Split-screen editorial scene|cup fading|car turning|realistic shadows/i);
  assert.match(plan.prompt, /source of truth/i);
  assert.doesNotMatch(plan.prompt, /Sora关停|物理课|前沿研究|水杯消失|车辆转弯穿帮/);
  const sourceBrief = plan.prompt.match(/English visual brief[^.]+(?:\.[^.]+){0,2}/i)?.[0] || '';
  assert.doesNotMatch(sourceBrief, /close-up hands|right hand|prominent hands|no natural body posture/i);
});

test('planner briefs with visible phone screens are rewritten to blank non-ui surfaces', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: '苹果AI入华三周，微信读书、支付宝、抖音踩了哪些坑',
      summary: '文章讨论国内 App 适配 Apple Intelligence 时遇到的隐私、权限和交互风险。',
      category_name: '技术应用',
    },
    {
      planner: async () => ({
        needed: true,
        alt: 'Apple Intelligence app integration cover',
        visual_angle: 'Show app integration safeguards without showing a real interface.',
        prompt: 'A sleek smartphone lies face up, its screen displaying a soft abstract apple-shaped light pattern, with a translucent manual confirmation slider in the foreground, no readable text.',
      }),
    },
  );

  const sourceBrief = plan.prompt.match(/English visual brief[^.]+(?:\.[^.]+){0,3}/i)?.[0] || plan.prompt;
  assert.match(sourceBrief, /blank|turned away|non-legible|non-ui|abstract translucent shape/i);
  assert.doesNotMatch(sourceBrief, /face up|screen displaying|manual confirmation slider|real interface/i);
  assert.doesNotMatch(plan.prompt, /苹果AI|微信读书|支付宝|抖音/);
});

test('planner briefs with blank phone screens prefer device backs instead of visible displays', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: '苹果AI入华三周，微信读书、支付宝、抖音踩了哪些坑',
      summary: '文章讨论国内 App 适配 Apple Intelligence 时遇到的隐私、权限和交互风险。',
      category_name: '技术应用',
    },
    {
      planner: async () => ({
        needed: true,
        alt: 'App integration safeguards cover',
        visual_angle: 'A symbolic still life representing app-level security controls.',
        prompt: 'A high angle close-up of a modern smartphone lying on a minimalist wooden desk. The phone screen is blank and dark. Two translucent geometric shields project above the screen, no text, no logos.',
      }),
    },
  );

  const sourceBrief = plan.prompt.match(/English visual brief[^.]+(?:\.[^.]+){0,3}/i)?.[0] || plan.prompt;
  assert.match(sourceBrief, /back side|camera lenses|matte case|front glass side hidden/i);
  assert.doesNotMatch(sourceBrief, /phone screen|above the screen|screen is blank|visible display/i);
});

test('semantic image review instructions use MVP quality gate instead of over-strict taste judging', () => {
  const { buildImageReviewMessages } = require('../ai/article-image');

  const messages = buildImageReviewMessages({
    article: {
      title: 'Winter miso ramen guide',
      summary: 'A food article about broth, noodles and toppings.',
      category_name: 'Food',
    },
    prompt: 'Warm bowl of miso ramen on a dinner table, no text, no logos.',
    dataUrl: 'data:image/png;base64,abc',
  });
  const reviewText = messages[1].content[0].text;

  assert.match(reviewText, /MVP/i);
  assert.match(reviewText, /food, travel, lifestyle, finance, technology/i);
  assert.match(reviewText, /Pass if the image is basically relevant/i);
  assert.match(reviewText, /People are allowed/i);
  assert.doesNotMatch(reviewText, /Pass clean abstract business or technology visuals/i);
  assert.doesNotMatch(reviewText, /Fail if it contains people/i);
});

test('fallback prompt is domain-neutral for non-technology articles', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      slug: 'winter-miso-ramen-guide',
      title: 'Winter miso ramen guide: richer broth, roasted corn and scallion oil',
      summary: 'A food article about balancing miso broth, noodles, toppings and a warm dinner table.',
      content_md: 'The article compares soup body, noodle texture, roasted corn sweetness, scallion oil fragrance and home table presentation.',
      category_name: 'Food',
    },
    { skipAIPlanner: true },
  );

  assert.match(plan.prompt, /miso ramen|broth|noodles|roasted corn|scallion oil|Food/i);
  assert.match(plan.prompt, /food|dish|ingredients|tableware|kitchen/i);
  assert.doesNotMatch(plan.prompt, /GPU modules|compute cluster|contract sheets|subscription software|business evidence/i);
});

test('CJK articles skip fallback image generation when no English planner brief is available', async () => {
  const { planArticleImage } = require('../ai/article-image');

  const plan = await planArticleImage(
    {
      title: '距合规大限40天：用开源工具搭一套AI合规流水线',
      summary: '文章讨论开源工具、合规流水线和自动化检查清单。',
      category_name: 'AI 工具箱',
    },
    { skipAIPlanner: true },
  );

  assert.equal(plan.needed, false);
  assert.match(plan.reason, /english_planner_required/i);
  assert.equal(plan.prompt, '');
});
