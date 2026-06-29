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
    getJSON: async () => ({ key: { usage: 0, limit: 1000 }, account: { plan_usage: 0, plan_limit: 1000 } }),
    postJSON: async (url, payload) => {
      if (payload.api_key === 'bad-key') throw new Error('unauthorized');
      return { results: [{ title: 'ok' }] };
    },
  });

  assert.equal(results[0].key, 'good-key');
  assert.equal(results[0].ok, true);
  assert.equal(results[0].error, '');
  assert.equal(results[1].key, 'bad-key');
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /API Key 无效或缺失/);
});

test('testTavilyKeys reports Tavily usage quota for valid keys', async () => {
  const results = await testTavilyKeys('good-key', {
    getJSON: async (url, options) => {
      assert.equal(url, 'https://api.tavily.com/usage');
      assert.equal(options.headers.Authorization, 'Bearer good-key');
      return {
        key: { usage: 230, limit: 1000, search_usage: 180 },
        account: { current_plan: 'Researcher', plan_usage: 400, plan_limit: 1000 },
      };
    },
    postJSON: async () => ({ results: [{ title: 'ok' }] }),
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].quota.key.used, 230);
  assert.equal(results[0].quota.key.limit, 1000);
  assert.equal(results[0].quota.key.remaining, 770);
  assert.equal(results[0].quota.account.plan, 'Researcher');
  assert.equal(results[0].quota.account.remaining, 600);
  assert.match(results[0].quotaText, /Key 剩余额度：770\/1000/);
  assert.match(results[0].quotaText, /账号剩余额度：600\/1000/);
});

test('testTavilyKeys explains official Tavily failure reasons clearly', async () => {
  const results = await testTavilyKeys('bad-key\nlimited-key', {
    getJSON: async (url, options) => {
      const key = options.headers.Authorization.replace('Bearer ', '');
      if (key === 'bad-key') {
        const err = new Error('Unauthorized: missing or invalid API key.');
        err.statusCode = 401;
        err.body = { detail: { error: 'Unauthorized: missing or invalid API key.' } };
        throw err;
      }
      return { key: { usage: 1000, limit: 1000 }, account: { plan_usage: 1000, plan_limit: 1000 } };
    },
    postJSON: async (url, payload) => {
      if (payload.api_key === 'limited-key') {
        const err = new Error("This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com");
        err.statusCode = 432;
        err.body = { detail: { error: err.message } };
        throw err;
      }
      return { results: [{ title: 'ok' }] };
    },
  });

  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /API Key 无效或缺失/);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /套餐或 Key 额度已用尽/);
  assert.match(results[1].quotaText, /Key 剩余额度：0\/1000/);
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
