function cleanValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAgentLogAI(log = {}) {
  const meta = log.meta && typeof log.meta === 'object' ? log.meta : {};
  const provider = cleanValue(meta.provider || meta.aiProvider || meta.ai_provider);
  const model = cleanValue(meta.model || meta.aiModel || meta.ai_model);
  if (provider || model) return { provider, model };

  const detail = String(log.detail || '');
  const viaMatch = detail.match(/\(via\s+([^)]+)\)\s*$/i);
  if (viaMatch) return { provider: viaMatch[1].trim(), model: '' };

  const suffixMatch = detail.match(/\(([^()]+)\)\s*$/);
  if (suffixMatch && !/^\d+\s*分$/.test(suffixMatch[1].trim())) {
    return { provider: suffixMatch[1].trim(), model: '' };
  }

  return { provider: '', model: '' };
}

function normalizeAgentLogDisplay(log = {}) {
  const status = String(log.status || '').trim();
  const detail = String(log.detail || '');
  const action = String(log.action || '');
  const text = `${action} ${detail}`;

  if (status === 'success' || status === 'completed') return { label: '成功', className: 'published' };
  if (status === 'running' || status === 'working') return { label: '运行中', className: 'planned' };
  if (status === 'failed' || status === 'error') {
    if (/(?:未达标|待写重试|等待重写|未发布|style_check_failed)/i.test(text)) {
      return { label: '待重写', className: 'quality' };
    }
    return { label: '失败', className: 'archived' };
  }
  return { label: status || '空闲', className: 'draft' };
}

function enrichAgentLogAI(log = {}) {
  const ai = normalizeAgentLogAI(log);
  const display = normalizeAgentLogDisplay(log);
  return {
    ...log,
    ai_provider: ai.provider,
    ai_model: ai.model,
    display_status: display.label,
    display_status_class: display.className,
  };
}

function enrichAgentLogsAI(logs = []) {
  return logs.map(enrichAgentLogAI);
}

module.exports = {
  normalizeAgentLogAI,
  normalizeAgentLogDisplay,
  enrichAgentLogAI,
  enrichAgentLogsAI,
};
