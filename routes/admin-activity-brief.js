const { normalizeAgentLogDisplay } = require('./agent-log-ai');

function toTime(log = {}) {
  const value = log.created_at || log.updated_at || '';
  const time = Date.parse(String(value).replace(' ', 'T'));
  return Number.isFinite(time) ? time : 0;
}

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getMeta(log = {}) {
  return log.meta && typeof log.meta === 'object' ? log.meta : {};
}

function isMoALog(log = {}) {
  const meta = getMeta(log);
  const provider = cleanText(meta.provider || log.ai_provider || '');
  return meta.ai_mode === 'moa'
    || meta.ai_mode === 'moa_fallback'
    || provider.startsWith('MoA:')
    || !!meta.moa_error;
}

function modeLabel(log = {}) {
  const meta = getMeta(log);
  const provider = cleanText(meta.provider || log.ai_provider || '');
  if (meta.ai_mode === 'moa_fallback' || meta.moa_error) return 'MoA 回退';
  if (meta.ai_mode === 'moa' || provider.startsWith('MoA:')) return 'MoA 聚合';
  return '单模型';
}

function modelName(log = {}) {
  const meta = getMeta(log);
  return cleanText(meta.model || log.ai_model || '');
}

function buildMethod(log = {}) {
  const model = modelName(log);
  const label = modeLabel(log);
  return model ? `${label} / ${model}` : label;
}

function candidateLabel(candidate = {}) {
  const provider = cleanText(candidate.provider || candidate.name || '');
  const model = cleanText(candidate.model || '');
  if (provider && model) return `${provider}/${model}`;
  return provider || model || '';
}

function buildLatestMoA(logs = []) {
  const moaLogs = logs.filter(isMoALog);
  if (moaLogs.length === 0) return null;

  const sorted = moaLogs
    .slice()
    .sort((a, b) => {
      const candidateDelta = (getMeta(b).moa_candidates?.length || 0) - (getMeta(a).moa_candidates?.length || 0);
      if (candidateDelta !== 0) return candidateDelta;
      return toTime(b) - toTime(a);
    });
  const log = sorted[0];
  const meta = getMeta(log);
  const candidates = Array.isArray(meta.moa_candidates) ? meta.moa_candidates : [];
  const failedCandidates = Number(meta.moa_failed_candidates || 0);
  const note = cleanText(meta.moa_error || log.detail || '');

  return {
    time: log.created_at || '',
    modeLabel: modeLabel(log),
    provider: cleanText(meta.provider || log.ai_provider || ''),
    model: modelName(log),
    candidateCount: candidates.length,
    failedCandidates,
    candidates: candidates.map(candidateLabel).filter(Boolean).slice(0, 5),
    note,
  };
}

function actionSummary(log = {}) {
  const action = cleanText(log.action, '系统动作');
  const detail = cleanText(log.detail, '');
  return detail ? `${action}：${detail}` : action;
}

function buildActions(logs = [], limit = 8) {
  return logs
    .slice()
    .sort((a, b) => toTime(b) - toTime(a))
    .filter((log) => cleanText(log.action || log.detail))
    .slice(0, limit)
    .map((log) => {
      const display = log.display_status
        ? { label: log.display_status, className: log.display_status_class || 'planned' }
        : normalizeAgentLogDisplay(log);
      return {
        time: log.created_at || '',
        role: cleanText(log.agent_role, 'system'),
        status: cleanText(display.label, '未知'),
        statusClass: cleanText(display.className, 'planned'),
        summary: actionSummary(log),
        method: buildMethod(log),
      };
    });
}

function buildHealth(stats = {}, logs = []) {
  const recentFailures = logs.filter((log) => log.status === 'failed' || log.status === 'error').length;
  return [
    { label: '已发布文章', value: Number(stats.totalArticles || 0), tone: 'success' },
    { label: '待生成计划', value: Number(stats.totalPlanned || 0), tone: 'info' },
    { label: '近期异常', value: recentFailures, tone: recentFailures > 0 ? 'warning' : 'success' },
  ];
}

function buildActivityBrief({ logs = [], stats = {}, config = {} } = {}) {
  const latestMoA = buildLatestMoA(logs);
  return {
    generatedAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' '),
    health: buildHealth(stats, logs),
    moa: {
      enabled: config.moa_enabled === '1',
      latest: latestMoA,
    },
    actions: buildActions(logs),
  };
}

module.exports = {
  buildActivityBrief,
  buildActions,
  buildLatestMoA,
  buildMethod,
  modeLabel,
};
