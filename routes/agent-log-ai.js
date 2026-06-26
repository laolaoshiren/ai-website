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

function enrichAgentLogAI(log = {}) {
  const ai = normalizeAgentLogAI(log);
  return {
    ...log,
    ai_provider: ai.provider,
    ai_model: ai.model,
  };
}

function enrichAgentLogsAI(logs = []) {
  return logs.map(enrichAgentLogAI);
}

module.exports = {
  normalizeAgentLogAI,
  enrichAgentLogAI,
  enrichAgentLogsAI,
};
