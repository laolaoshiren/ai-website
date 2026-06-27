const test = require('node:test');
const assert = require('node:assert/strict');

const { buildArticleRelations } = require('../routes/article-relations');

test('ranks related articles by category, keyword overlap, and engagement', () => {
  const current = {
    id: 1,
    title: 'Apple Intelligence 2.0 半年实测',
    category_id: 10,
    seo_keywords: 'Apple Intelligence, 端侧AI, iPhone',
    view_count: 10,
  };
  const all = [
    current,
    {
      id: 2,
      title: '端侧AI如何改变手机体验',
      slug: 'edge-ai-phone',
      category_id: 10,
      seo_keywords: '端侧AI, iPhone',
      view_count: 60,
      status: 'published',
    },
    {
      id: 3,
      title: '数据库索引优化',
      slug: 'db-index',
      category_id: 10,
      seo_keywords: '数据库, SQL',
      view_count: 500,
      status: 'published',
    },
    {
      id: 4,
      title: 'Apple Intelligence 隐私争议',
      slug: 'apple-privacy',
      category_id: 20,
      seo_keywords: 'Apple Intelligence, 隐私',
      view_count: 20,
      status: 'published',
    },
  ];

  const result = buildArticleRelations(current, all, { relatedLimit: 3, pathLimit: 2 });

  assert.deepEqual(result.relatedArticles.map(a => a.slug), ['edge-ai-phone', 'apple-privacy', 'db-index']);
  assert.equal(result.relatedArticles.some(a => a.id === current.id), false);
  assert.equal(result.topicPath.length, 2);
});

test('returns empty relation sets when there are no candidates', () => {
  const result = buildArticleRelations({ id: 1 }, [{ id: 1 }]);

  assert.deepEqual(result.relatedArticles, []);
  assert.deepEqual(result.topicPath, []);
});
