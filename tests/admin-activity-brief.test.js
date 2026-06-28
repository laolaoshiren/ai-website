const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

test('builds a concise dashboard brief from historical agent logs', () => {
  const { buildActivityBrief } = require('../routes/admin-activity-brief');

  const brief = buildActivityBrief({
    config: { moa_enabled: '1' },
    stats: { totalArticles: 12, totalPlanned: 3 },
    logs: [
      {
        agent_role: 'writer',
        action: '撰写文章',
        status: 'success',
        detail: '完成: AI Agent落地复盘',
        created_at: '2026-06-28 10:00:00',
        meta: {
          ai_mode: 'moa',
          provider: 'MoA:OpenRouter',
          model: 'gpt-4.1-mini',
          moa_candidates: [
            { provider: 'A', model: 'a-model' },
            { provider: 'B', model: 'b-model' },
            { provider: 'C', model: 'c-model' },
          ],
          moa_failed_candidates: 1,
        },
      },
      {
        agent_role: 'reviewer',
        action: '审核文章',
        status: 'success',
        detail: '通过: AI Agent落地复盘',
        created_at: '2026-06-28 10:01:00',
        meta: { ai_mode: 'moa', provider: 'MoA:OpenRouter', model: 'gpt-4.1-mini' },
      },
      {
        agent_role: 'seo_expert',
        action: 'SEO优化',
        status: 'success',
        detail: '完成: 12 个页面',
        created_at: '2026-06-28 11:00:00',
      },
    ],
  });

  assert.equal(brief.moa.enabled, true);
  assert.equal(brief.moa.latest.modeLabel, 'MoA 聚合');
  assert.equal(brief.moa.latest.candidateCount, 3);
  assert.equal(brief.moa.latest.failedCandidates, 1);
  assert.equal(brief.actions[0].summary, 'SEO优化：完成: 12 个页面');
  assert.equal(brief.actions[0].status, '成功');
  assert.equal(brief.actions[0].statusClass, 'published');
  assert.equal(brief.actions[1].method, 'MoA 聚合 / gpt-4.1-mini');
  assert.equal(brief.health[0].value, 12);
});

test('marks MoA fallback clearly in the dashboard brief', () => {
  const { buildActivityBrief } = require('../routes/admin-activity-brief');

  const brief = buildActivityBrief({
    config: { moa_enabled: '1' },
    stats: {},
    logs: [
      {
        agent_role: 'writer',
        action: '撰写文章',
        status: 'success',
        detail: '完成: 单模型兜底文章',
        created_at: '2026-06-28 12:00:00',
        meta: {
          ai_mode: 'moa_fallback',
          provider: 'OpenRouter',
          model: 'gpt-4.1-mini',
          moa_error: 'MoA 候选结果不足',
        },
      },
    ],
  });

  assert.equal(brief.moa.latest.modeLabel, 'MoA 回退');
  assert.equal(brief.actions[0].method, 'MoA 回退 / gpt-4.1-mini');
  assert.match(brief.moa.latest.note, /MoA 候选结果不足/);
});

test('admin dashboard renders the activity brief in a scannable summary block', async () => {
  const { buildActivityBrief } = require('../routes/admin-activity-brief');
  const activityBrief = buildActivityBrief({
    config: { moa_enabled: '1' },
    stats: { totalArticles: 12, totalPlanned: 3, activeProviders: 2, totalProviders: 3 },
    logs: [
      {
        agent_role: 'writer',
        action: '撰写文章',
        status: 'success',
        detail: '完成: AI Agent落地复盘',
        created_at: '2026-06-28 10:00:00',
        meta: {
          ai_mode: 'moa',
          provider: 'MoA:OpenRouter',
          model: 'gpt-4.1-mini',
          moa_candidates: [{ provider: 'A', model: 'a-model' }, { provider: 'B', model: 'b-model' }],
        },
      },
    ],
  });

  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'),
    {
      title: 'Dashboard',
      currentPath: '/admin',
      csrfToken: 'token',
      stats: {
        totalArticles: 12,
        totalPlanned: 3,
        totalCategories: 4,
        totalPageviews: 0,
        activeProviders: 2,
        totalProviders: 3,
      },
      activityBrief,
      agentLogs: [],
      agentStatuses: {},
      agentRoles: ['writer'],
      agentRoleNames: { writer: '写手' },
      schedules: [],
      outage: { active: false },
      rageStatus: { active: false, level: 3 },
      workMode: 'smart',
      getConfig: () => ({ ai_loop_enabled: '1' }),
      success: '',
      error: '',
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /系统运行简报/);
  assert.match(html, /MoA 聚合/);
  assert.match(html, /AI Agent落地复盘/);
  assert.match(html, /gpt-4\.1-mini/);
});
