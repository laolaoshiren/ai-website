const test = require('node:test');
const assert = require('node:assert/strict');

function pngBase64(width = 1024, height = 768, payloadSize = 32000) {
  const buffer = Buffer.alloc(payloadSize, 17);
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

test('image provider keys accept newline and comma separated values', () => {
  const { parseImageProviderKeys } = require('../ai/article-image');

  assert.deepEqual(
    parseImageProviderKeys(' sk-a\r\nsk-b, sk-c\nsk-a '),
    ['sk-a', 'sk-b', 'sk-c'],
  );
});

test('image endpoint accepts provider base URL or full generations endpoint', () => {
  const { normalizeImageEndpoint } = require('../ai/article-image');

  assert.equal(
    normalizeImageEndpoint('https://apihub.agnes-ai.com/v1'),
    'https://apihub.agnes-ai.com/v1/images/generations',
  );
  assert.equal(
    normalizeImageEndpoint('https://apihub.agnes-ai.com/v1/images/generations'),
    'https://apihub.agnes-ai.com/v1/images/generations',
  );
});

test('image provider call retries the next key and requests base64 output', async () => {
  const { callImageProvider, resetImageProviderKeyCursor } = require('../ai/article-image');
  resetImageProviderKeyCursor();
  const calls = [];

  const result = await callImageProvider(
    {
      id: 7,
      name: 'Agnes',
      base_url: 'https://apihub.agnes-ai.com/v1',
      api_key: 'bad-key\nok-key',
      model: 'agnes-image-2.1-flash',
      enabled: true,
    },
    'editorial image prompt',
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        if (calls.length === 1) {
          return {
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ error: { message: 'invalid key' } }),
          };
        }
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: pngBase64() }] }),
        };
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.Authorization, 'Bearer bad-key');
  assert.equal(calls[1].headers.Authorization, 'Bearer ok-key');
  assert.equal(calls[1].url, 'https://apihub.agnes-ai.com/v1/images/generations');
  assert.equal(calls[1].body.return_base64, true);
  assert.equal(calls[1].body.extra_body.response_format, 'b64_json');
  assert.equal(result.provider, 'Agnes');
  assert.equal(result.model, 'agnes-image-2.1-flash');
  assert.ok(Buffer.isBuffer(result.buffer));
});

test('image provider test validates the generated image without exposing keys', async () => {
  const { testImageProvider, resetImageProviderKeyCursor } = require('../ai/article-image');
  resetImageProviderKeyCursor();

  const result = await testImageProvider(
    {
      id: 8,
      name: 'Agnes',
      base_url: 'https://apihub.agnes-ai.com/v1',
      api_key: 'secret-key',
      model: 'agnes-image-2.1-flash',
      enabled: true,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ data: [{ b64_json: pngBase64() }] }),
      }),
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.provider, 'Agnes');
  assert.equal(result.model, 'agnes-image-2.1-flash');
  assert.doesNotMatch(JSON.stringify(result), /secret-key/);
});
