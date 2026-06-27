const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db/database');

let snapshot;

test.before(async () => {
  await db.initDb();
  snapshot = JSON.parse(JSON.stringify(db.getDb()));
});

test.after(() => {
  const current = db.getDb();
  for (const key of Object.keys(current)) delete current[key];
  Object.assign(current, snapshot);
  db.saveDb();
});

function resetPages() {
  const current = db.getDb();
  current.pages = [];
  current.agent_logs = [];
  current.agent_status = {};
  current._counters.pages = 0;
  current._counters.agent_logs = 0;
}

test('database page writes are immediately visible to the caller', () => {
  resetPages();

  const id = db.insertPage({
    title: '自治状态机测试文章',
    slug: 'autonomy-lifecycle-test',
    status: 'planned',
  });

  assert.equal(typeof id, 'number');
  assert.equal(db.getPageById(id).title, '自治状态机测试文章');
});

test('claimPlannedPages atomically moves planned pages into writing state', () => {
  resetPages();
  const firstId = db.insertPage({ title: '待领取 A', slug: 'claim-a', status: 'planned' });
  const secondId = db.insertPage({ title: '待领取 B', slug: 'claim-b', status: 'planned' });

  const firstClaim = db.claimPlannedPages(1, 'worker-a');
  const secondClaim = db.claimPlannedPages(2, 'worker-b');

  assert.deepEqual(firstClaim.map(p => p.id), [firstId]);
  assert.deepEqual(secondClaim.map(p => p.id), [secondId]);

  const firstPage = db.getPageById(firstId);
  const secondPage = db.getPageById(secondId);
  assert.equal(firstPage.status, 'writing');
  assert.equal(firstPage.claimed_by, 'worker-a');
  assert.equal(secondPage.status, 'writing');
  assert.equal(secondPage.claimed_by, 'worker-b');
});

test('claimPlannedPages skips retry-delayed pages and recovers expired writing locks', () => {
  resetPages();
  const delayedId = db.insertPage({ title: 'Delayed retry', slug: 'delayed-retry', status: 'planned' });
  const readyId = db.insertPage({ title: 'Ready page', slug: 'ready-page', status: 'planned' });
  const expiredId = db.insertPage({ title: 'Expired lock', slug: 'expired-lock', status: 'writing' });
  const activeId = db.insertPage({ title: 'Active lock', slug: 'active-lock', status: 'writing' });

  db.updatePage(delayedId, { next_retry_at: '2999-01-01 00:00:00' });
  db.updatePage(expiredId, {
    claimed_by: 'old-worker',
    claimed_at: '2000-01-01 00:00:00',
    lock_expires_at: '2000-01-01 00:00:00',
  });
  db.updatePage(activeId, {
    claimed_by: 'active-worker',
    claimed_at: '2999-01-01 00:00:00',
    lock_expires_at: '2999-01-01 00:00:00',
  });

  const claimed = db.claimPlannedPages(10, 'worker-new');
  const claimedIds = claimed.map(p => p.id).sort((a, b) => a - b);

  assert.deepEqual(claimedIds, [readyId, expiredId].sort((a, b) => a - b));
  assert.equal(db.getPageById(delayedId).status, 'planned');
  assert.equal(db.getPageById(activeId).claimed_by, 'active-worker');
  assert.equal(db.getPageById(expiredId).claimed_by, 'worker-new');
});

test('releasePageClaim clears writing ownership and keeps retry scheduling', () => {
  resetPages();
  const pageId = db.insertPage({ title: 'Release claim', slug: 'release-claim', status: 'planned' });
  const [claimed] = db.claimPlannedPages(1, 'worker-release');
  const retryAt = db.retryTimeAfterAttempts(claimed.attempt_count);

  db.releasePageClaim(pageId, {
    status: 'planned',
    last_error: 'temporary failure',
    next_retry_at: retryAt,
  });

  const page = db.getPageById(pageId);
  assert.equal(page.status, 'planned');
  assert.equal(page.claimed_by, null);
  assert.equal(page.claimed_at, null);
  assert.equal(page.lock_expires_at, null);
  assert.equal(page.last_error, 'temporary failure');
  assert.equal(page.next_retry_at, retryAt);
});

test('recovers expired writing locks back to the planned queue in bulk', () => {
  resetPages();
  const expiredA = db.insertPage({ title: 'Expired A', slug: 'expired-a', status: 'writing' });
  const expiredB = db.insertPage({ title: 'Expired B', slug: 'expired-b', status: 'writing' });
  const active = db.insertPage({ title: 'Active C', slug: 'active-c', status: 'writing' });

  db.updatePage(expiredA, {
    claimed_by: 'lost-worker-a',
    claimed_at: '2000-01-01 00:00:00',
    lock_expires_at: '2000-01-01 00:00:00',
  });
  db.updatePage(expiredB, {
    claimed_by: 'lost-worker-b',
    claimed_at: '2000-01-01 00:00:00',
    lock_expires_at: '2000-01-01 00:00:00',
  });
  db.updatePage(active, {
    claimed_by: 'active-worker',
    claimed_at: '2999-01-01 00:00:00',
    lock_expires_at: '2999-01-01 00:00:00',
  });

  const recovered = db.recoverExpiredWritingPages('test-recovery');

  assert.equal(recovered, 2);
  assert.equal(db.getPageById(expiredA).status, 'planned');
  assert.equal(db.getPageById(expiredA).claimed_by, null);
  assert.equal(db.getPageById(expiredA).last_error, 'expired_writing_lock:test-recovery');
  assert.equal(db.getPageById(expiredB).status, 'planned');
  assert.equal(db.getPageById(active).status, 'writing');
  assert.equal(db.getPageById(active).claimed_by, 'active-worker');
});

test('repairs published articles with empty or thin bodies before they reach SEO feeds', () => {
  resetPages();
  const emptyId = db.insertPage({
    title: 'Empty published',
    slug: 'empty-published',
    status: 'published',
    content_md: '',
    content_html: '',
    published_at: '2026-06-27 10:00:00',
  });
  const thinId = db.insertPage({
    title: 'Thin published',
    slug: 'thin-published',
    status: 'published',
    content_md: '太短的正文',
    content_html: '<p>太短的正文</p>',
    published_at: '2026-06-27 10:00:00',
  });
  const richId = db.insertPage({
    title: 'Rich published',
    slug: 'rich-published',
    status: 'published',
    content_md: '这是合格正文。'.repeat(120),
    content_html: `<p>${'这是合格正文。'.repeat(120)}</p>`,
    published_at: '2026-06-27 10:00:00',
  });

  const repaired = db.repairPublishedContentQuality('test-quality-repair');

  assert.equal(repaired, 2);
  assert.equal(db.getPageById(emptyId).status, 'planned');
  assert.equal(db.getPageById(emptyId).published_at, null);
  assert.equal(db.getPageById(emptyId).last_error, 'content_quality_repair:empty_body:test-quality-repair');
  assert.equal(db.getPageById(thinId).status, 'planned');
  assert.equal(db.getPageById(thinId).last_error, 'content_quality_repair:thin_body:test-quality-repair');
  assert.equal(db.getPageById(richId).status, 'published');
});

test('article outcome logs do not approve unpublished drafts', () => {
  const { buildArticleOutcomeLogs } = require('../scheduler/article-outcome');

  const logs = buildArticleOutcomeLogs(
    { title: '质检未通过的文章' },
    { title: '质检未通过的文章', published: false, styleScore: 72, provider: 'provider-a' },
    { reviewerAction: '审核文章' },
  );

  assert.deepEqual(logs, [
    {
      role: 'writer',
      action: '撰写文章',
      status: 'success',
      detail: '生成待重写: 质检未通过的文章 (provider-a)',
      meta: { provider: 'provider-a', model: '' },
    },
    {
      role: 'reviewer',
      action: '审核文章',
      status: 'failed',
      detail: '未发布，等待重写: 质检未通过的文章 (72分)',
      meta: { provider: 'provider-a', model: '' },
    },
  ]);
});
