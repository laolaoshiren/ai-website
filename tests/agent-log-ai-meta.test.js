const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

test('normalizes AI provider and model from structured log meta', () => {
  const { normalizeAgentLogAI } = require('../routes/agent-log-ai');

  const info = normalizeAgentLogAI({
    detail: '完成: demo',
    meta: { provider: 'OpenRouter', model: 'gpt-4.1-mini' },
  });

  assert.deepEqual(info, {
    provider: 'OpenRouter',
    model: 'gpt-4.1-mini',
  });
});

test('normalizes AI provider from legacy log detail', () => {
  const { normalizeAgentLogAI } = require('../routes/agent-log-ai');

  assert.deepEqual(
    normalizeAgentLogAI({ detail: '评分: 87/100 (via SiliconFlow)' }),
    { provider: 'SiliconFlow', model: '' },
  );

  assert.deepEqual(
    normalizeAgentLogAI({ detail: '完成: 某篇文章 (OpenAI)' }),
    { provider: 'OpenAI', model: '' },
  );
});

test('normalizes visible log status for quality holds and hard failures', () => {
  const { normalizeAgentLogDisplay } = require('../routes/agent-log-ai');

  assert.deepEqual(
    normalizeAgentLogDisplay({
      status: 'failed',
      detail: '未达标，保留待写重试: demo (58分)',
    }),
    { label: '待重写', className: 'quality' },
  );

  assert.deepEqual(
    normalizeAgentLogDisplay({
      status: 'failed',
      detail: '失败: demo - 无法从 AI 响应中解析 JSON',
    }),
    { label: '失败', className: 'archived' },
  );
});

test('admin logs view renders AI provider and model columns', async () => {
  const { enrichAgentLogAI } = require('../routes/agent-log-ai');
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'logs.ejs'),
    {
      title: 'Agent Logs',
      currentPath: '/admin/logs',
      csrfToken: 'token',
      logs: [
        enrichAgentLogAI({
          id: 1,
          agent_role: 'writer',
          action: '撰写文章',
          status: 'success',
          detail: '完成: demo',
          meta: { provider: 'OpenRouter', model: 'gpt-4.1-mini' },
          created_at: '2026-06-27 10:00:00',
        }),
      ],
      agentStatuses: {},
      agentRoles: ['writer'],
      agentRoleNames: { writer: '写手' },
      pagination: {
        totalItems: 1,
        totalPages: 1,
        currentPage: 1,
        startItem: 1,
        endItem: 1,
        items: [],
      },
      total: 1,
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /AI/);
  assert.match(html, /OpenRouter/);
  assert.match(html, /gpt-4\.1-mini/);
});

test('admin dashboard recent logs render AI provider and model columns', async () => {
  const { enrichAgentLogAI } = require('../routes/agent-log-ai');
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'),
    {
      title: 'Dashboard',
      currentPath: '/admin',
      csrfToken: 'token',
      stats: {
        totalArticles: 1,
        totalPlanned: 0,
        totalCategories: 1,
        totalPageviews: 0,
        activeProviders: 1,
        totalProviders: 1,
      },
      agentLogs: [
        enrichAgentLogAI({
          agent_role: 'writer',
          action: '撰写文章',
          status: 'success',
          detail: '完成: demo',
          meta: { provider: 'OpenRouter', model: 'gpt-4.1-mini' },
          created_at: '2026-06-27 10:00:00',
        }),
      ],
      agentStatuses: {},
      agentRoles: ['writer'],
      agentRoleNames: { writer: '写手' },
      schedules: [],
      outage: { active: false },
      rageStatus: { active: false, level: 3 },
      workMode: 'smart',
      getConfig: () => ({ ai_loop_enabled: '0' }),
      success: '',
      error: '',
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(html, /AI/);
  assert.match(html, /OpenRouter/);
  assert.match(html, /gpt-4\.1-mini/);
});

test('admin agent status views render image agents with Chinese names', async () => {
  const { AGENT_ROLES, AGENT_ROLE_NAMES, buildAgentStatuses } = require('../routes/agent-status');
  const agentStatuses = buildAgentStatuses({}, []);

  const commonLocals = {
    currentPath: '/admin',
    csrfToken: 'token',
    agentLogs: [],
    agentStatuses,
    agentRoles: AGENT_ROLES,
    agentRoleNames: AGENT_ROLE_NAMES,
    pagination: {
      totalItems: 0,
      totalPages: 1,
      currentPage: 1,
      startItem: 0,
      endItem: 0,
      items: [],
    },
    total: 0,
  };

  const dashboardHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'dashboard.ejs'),
    {
      ...commonLocals,
      title: 'Dashboard',
      stats: {
        totalArticles: 0,
        totalPlanned: 0,
        totalCategories: 0,
        totalPageviews: 0,
        activeProviders: 1,
        totalProviders: 1,
      },
      schedules: [],
      outage: { active: false },
      rageStatus: { active: false, level: 3 },
      workMode: 'smart',
      getConfig: () => ({ ai_loop_enabled: '0' }),
      success: '',
      error: '',
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  const logsHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'admin', 'logs.ejs'),
    {
      ...commonLocals,
      title: 'Agent 日志',
      logs: [],
    },
    { views: [path.join(__dirname, '..', 'views', 'admin')] },
  );

  assert.match(dashboardHtml, /配图设计师/);
  assert.match(dashboardHtml, /配图审核员/);
  assert.match(logsHtml, /配图设计师/);
  assert.match(logsHtml, /配图审核员/);
});
