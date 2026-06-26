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
