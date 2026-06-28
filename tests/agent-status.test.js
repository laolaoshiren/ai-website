const test = require('node:test');
const assert = require('node:assert/strict');

const { AGENT_ROLES, AGENT_ROLE_NAMES, buildAgentStatuses } = require('../routes/agent-status');

test('includes every built-in agent role with readable Chinese names', () => {
  assert.deepEqual(
    AGENT_ROLES,
    [
      'site_manager',
      'planner',
      'news_collector',
      'writer',
      'reviewer',
      'editor',
      'image_designer',
      'image_reviewer',
      'seo_expert',
      'user_tester',
      'analyzer',
      'technician',
      'polisher',
    ],
  );

  assert.equal(AGENT_ROLE_NAMES.image_designer, '配图设计师');
  assert.equal(AGENT_ROLE_NAMES.image_reviewer, '配图审核员');

  const statuses = buildAgentStatuses({}, []);
  assert.equal(statuses.image_designer.roleName, '配图设计师');
  assert.equal(statuses.image_designer.displayText, '空闲');
  assert.equal(statuses.image_reviewer.roleName, '配图审核员');
  assert.equal(statuses.image_reviewer.displayText, '空闲');
});

test('derives visible agent status from latest logs instead of stale idle state', () => {
  const statuses = buildAgentStatuses(
    {
      writer: { status: 'idle', current_task: null, updated_at: '2026-06-24 05:30:00' },
    },
    [
      {
        agent_role: 'writer',
        action: '撰写文章',
        status: 'success',
        detail: '完成: AI 投资复盘',
        created_at: '2026-06-24 05:29:30',
      },
    ],
  );

  assert.equal(statuses.writer.status, 'success');
  assert.equal(statuses.writer.dotClass, 'dot-green');
  assert.match(statuses.writer.displayText, /已完成/);
  assert.match(statuses.writer.displayText, /AI 投资复盘/);
});

test('keeps a newer explicit idle state instead of showing an old running log', () => {
  const statuses = buildAgentStatuses(
    {
      technician: {
        status: 'idle',
        current_task: null,
        updated_at: '2026-06-27 19:32:22',
      },
    },
    [
      {
        agent_role: 'technician',
        action: 'heartbeat',
        status: 'running',
        detail: 'start heartbeat',
        created_at: '2026-06-27 19:30:00',
      },
    ],
  );

  assert.equal(statuses.technician.status, 'idle');
  assert.equal(statuses.technician.dotClass, 'dot-gray');
  assert.equal(statuses.technician.displayText, '空闲');
});

test('shows quality gate failures as pending rewrite instead of system errors', () => {
  const statuses = buildAgentStatuses(
    {},
    [
      {
        agent_role: 'editor',
        action: 'style gate',
        status: 'failed',
        detail: '未达标，保留待写重试: Apple Intelligence 2.0 半年实测 (58分)',
        created_at: '2026-06-27 19:32:21',
      },
    ],
  );

  assert.equal(statuses.editor.status, 'quality_hold');
  assert.equal(statuses.editor.dotClass, 'dot-yellow');
  assert.match(statuses.editor.displayText, /待重写/);
  assert.match(statuses.editor.displayText, /Apple Intelligence/);
});

test('normalizes running and failed logs into dashboard states', () => {
  const statuses = buildAgentStatuses(
    {},
    [
      {
        agent_role: 'reviewer',
        action: '审核文章',
        status: 'running',
        detail: '审核: Agent OS 技术栈',
        created_at: '2026-06-24 05:31:00',
      },
      {
        agent_role: 'planner',
        action: '结构规划',
        status: 'failed',
        detail: 'AI provider timeout',
        created_at: '2026-06-24 05:30:00',
      },
    ],
  );

  assert.equal(statuses.reviewer.status, 'working');
  assert.equal(statuses.reviewer.dotClass, 'dot-blue');
  assert.match(statuses.reviewer.displayText, /审核/);

  assert.equal(statuses.planner.status, 'error');
  assert.equal(statuses.planner.dotClass, 'dot-red');
  assert.match(statuses.planner.displayText, /AI provider timeout/);
});

test('keeps an explicit active working state when it is newer than the last log', () => {
  const statuses = buildAgentStatuses(
    {
      seo_expert: {
        status: 'working',
        current_task: 'SEO 审计运行中',
        updated_at: '2026-06-24 05:35:00',
      },
    },
    [
      {
        agent_role: 'seo_expert',
        action: 'SEO 审计',
        status: 'success',
        detail: '上一轮完成',
        created_at: '2026-06-24 05:20:00',
      },
    ],
  );

  assert.equal(statuses.seo_expert.status, 'working');
  assert.equal(statuses.seo_expert.dotClass, 'dot-blue');
  assert.match(statuses.seo_expert.displayText, /SEO 审计运行中/);
});
