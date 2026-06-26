/**
 * 真实测评员 Agent - 站在用户角度审查网站体验
 */
const { callAIForJSON } = require('./client');
const { getUserTesterPrompt } = require('./prompts');
const { getPublishedPages, getCategories, logAgent } = require('../db/database');
const { getSiteConfig } = require('../config');

async function runUserTester() {
  const pages = getPublishedPages(50);
  const categories = getCategories();
  const siteConfig = getSiteConfig();

  logAgent('user_tester', '用户体验测评', 'running', '开始从用户角度全面审查网站...');

  const messages = getUserTesterPrompt(pages, categories, siteConfig.url, siteConfig);
  const { data, model, tokensUsed, provider } = await callAIForJSON(messages, {
    taskType: 'user_test',
    maxTokens: 8192,
    temperature: 0.5,
  });
  const aiMeta = { provider, model };

  const scores = data.overall_score || {};
  logAgent(
    'user_tester',
    '体验评分',
    'success',
    `设计:${scores.design || '-'}/10 内容:${scores.content || '-'}/10 体验:${scores.ux || '-'}/10 信任:${scores.trust || '-'}/10 (via ${provider})`,
    aiMeta,
  );

  if (data.first_impression) {
    logAgent('user_tester', '第一印象', 'success', data.first_impression, aiMeta);
  }

  if (data.strengths) {
    for (const s of data.strengths) {
      logAgent('user_tester', '发现优点', 'success', s, aiMeta);
    }
  }

  if (data.issues) {
    for (const issue of data.issues) {
      const severityLabel = { critical: '严重', major: '主要', minor: '轻微' }[issue.severity] || '一般';
      logAgent(
        'user_tester',
        '发现问题',
        issue.severity === 'critical' ? 'failed' : 'success',
        `[${severityLabel}/${issue.category}] ${issue.description} -> 分派给 ${issue.assign_to}`,
        aiMeta,
      );

      logAgent(
        issue.assign_to || 'editor',
        '收到任务',
        'running',
        `[来自测评员] ${issue.suggestion} (优先级: ${issue.severity})`,
        aiMeta,
      );
    }
  }

  if (data.priority_actions) {
    for (const action of data.priority_actions) {
      logAgent('user_tester', '优先行动', 'success', `[${action.priority}] ${action.action} -> ${action.assign_to}`, aiMeta);
    }
  }

  if (data.content_quality_review) {
    for (const review of data.content_quality_review) {
      logAgent(
        'user_tester',
        '内容审查',
        'success',
        `${review.page_slug}: 易读性 ${review.readability} 价值 ${review.value} - ${review.suggestion}`,
        aiMeta,
      );
    }
  }

  return {
    scores: data.overall_score,
    firstImpression: data.first_impression,
    strengths: data.strengths?.length || 0,
    issues: data.issues?.length || 0,
    criticalIssues: data.issues?.filter(i => i.severity === 'critical').length || 0,
    priorityActions: data.priority_actions?.length || 0,
    retentionSuggestions: data.user_retention_suggestions,
    model,
    tokensUsed,
    provider,
  };
}

module.exports = { runUserTester };
