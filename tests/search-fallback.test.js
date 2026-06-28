const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectSearchResults,
  parseSearchRSS,
  resolveRedirectUrl,
  parseTavilyKeys,
  resetTavilyKeyCursor,
  searchTavily,
  maskTavilyKey,
  testTavilyKeys,
} = require('../ai/search');

test('collectSearchResults continues through empty and failed engines', async () => {
  const calls = [];
  const originalError = console.error;
  console.error = () => {};
  let results;
  try {
    results = await collectSearchResults(
      [
        async () => { calls.push('tavily'); return []; },
        async () => { calls.push('broken'); throw new Error('provider down'); },
        async () => {
          calls.push('rss');
          return [
            { title: 'First result', url: 'https://example.com/1', snippet: 'a', source: 'bing-news' },
            { title: 'Duplicate result', url: 'https://example.com/1', snippet: 'b', source: 'google-news' },
            { title: 'Second result', url: 'https://example.com/2', snippet: 'c', source: 'google-news' },
          ];
        },
      ],
      5,
    );
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(calls, ['tavily', 'broken', 'rss']);
  assert.deepEqual(results.map(r => r.url), ['https://example.com/1', 'https://example.com/2']);
});

test('parseSearchRSS extracts news search items', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[AI 搜索兜底上线]]></title>
      <link>https://example.com/news-a</link>
      <description><![CDATA[当 Tavily 不可用时，搜索引擎 RSS 继续提供新闻。]]></description>
      <pubDate>Fri, 27 Jun 2026 08:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;

  const items = parseSearchRSS(xml, 'bing-news');

  assert.deepEqual(items, [
    {
      title: 'AI 搜索兜底上线',
      url: 'https://example.com/news-a',
      snippet: '当 Tavily 不可用时，搜索引擎 RSS 继续提供新闻。',
      date: 'Fri, 27 Jun 2026 08:00:00 GMT',
      source: 'bing-news',
    },
  ]);
});

test('resolveRedirectUrl supports relative redirect locations', () => {
  assert.equal(
    resolveRedirectUrl('https://www.bing.com/news/search?q=ai', '/news/search?q=ai&format=rss'),
    'https://www.bing.com/news/search?q=ai&format=rss',
  );
});

test('parseTavilyKeys accepts newline and comma separated keys', () => {
  assert.deepEqual(
    parseTavilyKeys('tvly-a\n tvly-b, tvly-c \n\n tvly-a'),
    ['tvly-a', 'tvly-b', 'tvly-c'],
  );
});

test('maskTavilyKey hides the secret while keeping it recognizable', () => {
  assert.equal(maskTavilyKey('tvly-1234567890'), 'tvly-1...7890');
});

test('testTavilyKeys validates each key independently', async () => {
  const results = await testTavilyKeys('good-key\nbad-key', {
    postJSON: async (url, payload) => {
      if (payload.api_key === 'bad-key') throw new Error('unauthorized');
      return { results: [{ title: 'ok' }] };
    },
  });

  assert.deepEqual(results.map(item => ({ key: item.key, ok: item.ok, error: item.error })), [
    { key: 'good-key', ok: true, error: '' },
    { key: 'bad-key', ok: false, error: 'unauthorized' },
  ]);
});

test('searchTavily rotates keys and retries the next key on failure', async () => {
  resetTavilyKeyCursor();
  const calls = [];
  const originalError = console.error;
  console.error = () => {};
  const postJSON = async (url, payload) => {
    calls.push(payload.api_key);
    if (payload.api_key === 'bad-key') throw new Error('bad key');
    return { results: [{ title: 'T', url: 'https://example.com/t', content: 'S' }] };
  };

  let first;
  let second;
  try {
    first = await searchTavily('query one', 1, { apiKeys: 'bad-key\ngood-key', postJSON });
    second = await searchTavily('query two', 1, { apiKeys: 'bad-key\ngood-key', postJSON });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(calls, ['bad-key', 'good-key', 'good-key']);
  assert.equal(first[0].source, 'tavily');
  assert.equal(second[0].url, 'https://example.com/t');
});
