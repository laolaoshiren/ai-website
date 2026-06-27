const AGENT_ROLES = [
  'site_manager',
  'planner',
  'news_collector',
  'writer',
  'reviewer',
  'editor',
  'seo_expert',
  'user_tester',
  'analyzer',
  'technician',
  'polisher',
];

const AGENT_ROLE_NAMES = {
  site_manager: '站长',
  planner: '规划师',
  news_collector: '新闻采集',
  writer: '写手',
  reviewer: '审核',
  editor: '编辑',
  seo_expert: 'SEO专家',
  user_tester: '测评员',
  analyzer: '分析师',
  technician: '技术员',
  polisher: '润色师',
};

function toTimestamp(value) {
  if (!value) return 0;
  const normalized = String(value).replace(' ', 'T');
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeStatus(status) {
  if (status === 'quality_hold') return 'quality_hold';
  if (status === 'running' || status === 'working') return 'working';
  if (status === 'failed' || status === 'error') return 'error';
  if (status === 'success' || status === 'completed') return 'success';
  return 'idle';
}

function isQualityHoldLog(log = {}) {
  if (log.status !== 'failed' && log.status !== 'error') return false;
  const text = `${log.action || ''} ${log.detail || ''}`;
  return /(?:未达标|待写重试|等待重写|未发布|style_check_failed|quality gate)/i.test(text);
}

function buildCandidateFromLog(log) {
  const status = isQualityHoldLog(log) ? 'quality_hold' : normalizeStatus(log.status);
  return {
    status,
    current_task: log.detail || log.action || null,
    updated_at: log.created_at || null,
    action: log.action || null,
    source: 'log',
  };
}

function buildCandidateFromStored(stored) {
  const status = normalizeStatus(stored?.status);
  return {
    status,
    current_task: stored?.current_task || null,
    updated_at: stored?.updated_at || null,
    action: stored?.action || null,
    source: 'stored',
  };
}

function decorateStatus(role, candidate) {
  const status = candidate?.status || 'idle';
  const task = candidate?.current_task || '';
  const base = {
    role,
    roleName: AGENT_ROLE_NAMES[role] || role,
    status,
    current_task: task || null,
    updated_at: candidate?.updated_at || null,
    action: candidate?.action || null,
  };

  if (status === 'working') {
    return { ...base, dotClass: 'dot-blue', statusLabel: '工作中', displayText: task ? `工作中：${task}` : '工作中' };
  }
  if (status === 'success') {
    return { ...base, dotClass: 'dot-green', statusLabel: '已完成', displayText: task ? `已完成：${task}` : '已完成' };
  }
  if (status === 'error') {
    return { ...base, dotClass: 'dot-red', statusLabel: '异常', displayText: task ? `异常：${task}` : '异常' };
  }
  if (status === 'quality_hold') {
    return { ...base, dotClass: 'dot-yellow', statusLabel: '待重写', displayText: task ? `待重写：${task}` : '待重写' };
  }
  return { ...base, dotClass: 'dot-gray', statusLabel: '空闲', displayText: '空闲' };
}

function latestLogByRole(logs) {
  const latest = new Map();
  const sortedLogs = [...(logs || [])].sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));

  for (const log of sortedLogs) {
    if (!log?.agent_role || latest.has(log.agent_role)) continue;
    latest.set(log.agent_role, buildCandidateFromLog(log));
  }

  return latest;
}

function chooseCandidate(storedCandidate, logCandidate) {
  if (!logCandidate) return storedCandidate;
  if (!storedCandidate) return logCandidate;

  const storedTs = toTimestamp(storedCandidate.updated_at);
  const logTs = toTimestamp(logCandidate.updated_at);
  if (storedCandidate.status === 'idle' && logCandidate.status === 'working' && storedTs >= logTs) return storedCandidate;
  if (storedCandidate.status === 'idle') return logCandidate;
  return storedTs > logTs ? storedCandidate : logCandidate;
}

function buildAgentStatuses(storedStatuses = {}, logs = []) {
  const latestLogs = latestLogByRole(logs);
  const roles = new Set([...AGENT_ROLES, ...Object.keys(storedStatuses || {}), ...latestLogs.keys()]);
  const result = {};

  for (const role of roles) {
    const storedCandidate = buildCandidateFromStored(storedStatuses?.[role]);
    const logCandidate = latestLogs.get(role);
    result[role] = decorateStatus(role, chooseCandidate(storedCandidate, logCandidate));
  }

  return result;
}

module.exports = {
  AGENT_ROLES,
  AGENT_ROLE_NAMES,
  buildAgentStatuses,
  isQualityHoldLog,
  normalizeStatus,
};
