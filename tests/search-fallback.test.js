const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectSearchResults,
  parseSearchRSS,
  resolveRedirectUrl,
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
