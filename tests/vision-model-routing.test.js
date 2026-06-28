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

test('detects and marks multimodal models on a text AI provider', async () => {
  const { testProviderVisionCapabilities } = require('../ai/client');
  const calls = [];

  const result = await testProviderVisionCapabilities(
    {
      id: 9,
      name: 'Mixed Text AI',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-demo',
      model: 'text-only, vision-model',
      enabled: true,
    },
    {
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body });
        if (body.model === 'vision-model') {
          return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: '{"vision":true,"color":"red"}' } }] }),
          };
        }
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: '{"vision":false,"color":"unknown"}' } }] }),
        };
      },
    },
  );

  assert.deepEqual(calls.map(call => call.body.model), ['text-only', 'vision-model']);
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.deepEqual(result.visionModels, ['vision-model']);
  assert.equal(result.results['text-only'].supported, false);
  assert.equal(result.results['vision-model'].supported, true);
});

test('vision-capable provider candidates keep only marked multimodal models', () => {
  const { visionCapableProviderCandidates } = require('../ai/client');

  const candidates = visionCapableProviderCandidates([
    {
      id: 1,
      name: 'Mixed',
      enabled: true,
      model: 'text-only,vision-a,vision-b',
      vision_check_results: {
        'text-only': { supported: false },
        'vision-a': { supported: true },
        'vision-b': { supported: true },
      },
    },
    {
      id: 2,
      name: 'Unmarked',
      enabled: true,
      model: 'maybe-text',
    },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, 'Mixed');
  assert.equal(candidates[0].model, 'vision-a,vision-b');
});

test('semantic image review requires a vision-capable text AI model', async () => {
  const { reviewArticleImage } = require('../ai/article-image');
  const client = require('../ai/client');
  const original = client.callAIForJSON;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-review-'));
  const filePath = path.join(root, 'cover.png');
  fs.writeFileSync(filePath, Buffer.from(pngBase64(), 'base64'));

  client.callAIForJSON = async (messages, options) => {
    assert.equal(options.taskType, 'image_review');
    assert.equal(options.requireVision, true);
    assert.equal(options.moa, false);
    assert.equal(messages[1].content[1].type, 'image_url');
    return {
      data: { status: 'pass', score: 82, reason: 'basically relevant and coherent', issues: [] },
      provider: 'Vision Text AI',
      model: 'vision-model',
    };
  };

  try {
    const review = await reviewArticleImage({
      filePath,
      prompt: 'Warm bowl of miso ramen on a dinner table, no text, no logos.',
      article: { title: 'Winter miso ramen guide', summary: 'Food guide', category_name: 'Food' },
    });

    assert.equal(review.status, 'pass');
    assert.equal(review.semantic_score, 82);
  } finally {
    client.callAIForJSON = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
