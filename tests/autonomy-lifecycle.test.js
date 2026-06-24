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
    },
    {
      role: 'reviewer',
      action: '审核文章',
      status: 'failed',
      detail: '未发布，等待重写: 质检未通过的文章 (72分)',
    },
  ]);
});
