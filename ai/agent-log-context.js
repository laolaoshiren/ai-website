const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function normalizeLogIds(value) {
  const ids = Array.isArray(value) ? value : [value];
  const seen = new Set();
  return ids
    .map(id => parseInt(id, 10))
    .filter(id => Number.isFinite(id) && id > 0)
    .filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function withAgentLogContext(logId, fn) {
  if (typeof fn !== 'function') return fn;
  const current = storage.getStore() || { logIds: [] };
  const nextLogIds = normalizeLogIds([...(current.logIds || []), logId]);
  return storage.run({ ...current, logIds: nextLogIds }, fn);
}

function getAgentLogContext() {
  const current = storage.getStore() || {};
  const logIds = normalizeLogIds(current.logIds || []);
  return {
    ...current,
    logIds,
    logId: logIds.length ? logIds[logIds.length - 1] : null,
  };
}

module.exports = {
  withAgentLogContext,
  getAgentLogContext,
};
