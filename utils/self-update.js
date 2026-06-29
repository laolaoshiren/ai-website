const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO_API_URL = 'https://api.github.com/repos/laolaoshiren/ai-website/commits/master';
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const REQUEST_FILENAME = 'self-update-request.json';
const STATUS_FILENAME = 'self-update-status.json';
const LOG_FILENAME = 'self-update.log';
const WORKER_READY_MAX_AGE_MS = 10 * 60 * 1000;

function shortRevision(value) {
  const revision = String(value || '').trim();
  return revision ? revision.slice(0, 7) : '未知';
}

function normalizeRevision(value) {
  const revision = String(value || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(revision)) return '';
  return revision.toLowerCase();
}

function readTextIfExists(file) {
  try {
    if (!fs.existsSync(file)) return '';
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function appendLog(dataDir, line) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, LOG_FILENAME), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

function readLogTail(dataDir, maxChars = 5000) {
  const file = path.join(dataDir, LOG_FILENAME);
  try {
    if (!fs.existsSync(file)) return '';
    const text = fs.readFileSync(file, 'utf8');
    return text.slice(-maxChars);
  } catch {
    return '';
  }
}

function detectInstallType(options = {}) {
  const cwd = options.cwd || path.join(__dirname, '..');
  const env = options.env || process.env;
  const dockerenvPath = options.dockerenvPath || '/.dockerenv';
  const forced = String(env.AI_WEBSITE_INSTALL_TYPE || env.SELF_UPDATE_INSTALL_TYPE || '').trim().toLowerCase();

  if (forced === 'docker') return { type: 'docker', label: 'Docker' };
  if (forced === 'source') return { type: 'source', label: '源码' };
  if (fs.existsSync(dockerenvPath)) return { type: 'docker', label: 'Docker' };
  if (fs.existsSync(path.join(cwd, '.git'))) return { type: 'source', label: '源码' };
  return { type: 'unknown', label: '未识别' };
}

function getCurrentRevision(options = {}) {
  const cwd = options.cwd || path.join(__dirname, '..');
  const env = options.env || process.env;

  const envRevision = normalizeRevision(env.APP_REVISION || env.GIT_SHA || env.COMMIT_SHA);
  if (envRevision) return envRevision;

  const buildRevision = normalizeRevision(readTextIfExists(path.join(cwd, '.build-revision')));
  if (buildRevision) return buildRevision;

  if (fs.existsSync(path.join(cwd, '.git'))) {
    try {
      return normalizeRevision(execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }));
    } catch {}
  }

  return '';
}

async function fetchLatestRevision(options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  if (timer && timer.unref) timer.unref();

  try {
    const response = await fetch(REPO_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-website-self-update',
      },
      signal: controller?.signal,
    });
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const data = await response.json();
    const revision = normalizeRevision(data.sha);
    if (!revision) throw new Error('GitHub 没有返回有效 commit');
    return revision;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getRuntimeStatus(dataDir = DEFAULT_DATA_DIR) {
  const status = readJsonIfExists(path.join(dataDir, STATUS_FILENAME)) || {};
  return {
    worker_ready: status.worker_ready === true,
    status: status.status || 'unknown',
    message: status.message || '',
    updated_at: status.updated_at || null,
    started_at: status.started_at || null,
    finished_at: status.finished_at || null,
    request_id: status.request_id || null,
    target_revision: status.target_revision || null,
    log_tail: readLogTail(dataDir),
  };
}

function isRuntimeBusy(runtime) {
  return ['queued', 'running'].includes(runtime?.status);
}

function isDockerWorkerReady(runtime) {
  if (!runtime?.worker_ready || !runtime.updated_at) return false;
  const updatedAt = Date.parse(runtime.updated_at);
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt <= WORKER_READY_MAX_AGE_MS;
}

async function buildUpdateStatus(options = {}) {
  const cwd = options.cwd || path.join(__dirname, '..');
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const env = options.env || process.env;
  const install = detectInstallType({ cwd, env, dockerenvPath: options.dockerenvPath });
  const runtime = getRuntimeStatus(dataDir);
  const currentRevision = getCurrentRevision({ cwd, env });
  let latestRevision = '';
  let latestError = '';

  try {
    const provider = options.latestRevisionProvider || fetchLatestRevision;
    latestRevision = normalizeRevision(await provider());
    if (!latestRevision) throw new Error('没有检测到最新版 commit');
  } catch (err) {
    latestError = err.message || '检测最新版失败';
  }

  const hasUpdate = Boolean(latestRevision && (!currentRevision || currentRevision !== latestRevision));
  let canUpdate = false;
  let updateMode = 'unavailable';
  let updateBlockedReason = '';

  if (latestError) {
    updateBlockedReason = `无法检测最新版：${latestError}`;
  } else if (!hasUpdate && currentRevision) {
    updateBlockedReason = '当前已经是最新版';
  } else if (isRuntimeBusy(runtime)) {
    updateBlockedReason = '更新正在执行，请稍后查看结果';
  } else if (install.type === 'docker') {
    if (isDockerWorkerReady(runtime)) {
      canUpdate = true;
      updateMode = 'docker-worker';
    } else {
      updateBlockedReason = 'Docker 安装需要宿主机更新执行器，当前未就绪';
    }
  } else if (install.type === 'source') {
    if (fs.existsSync(path.join(cwd, '.git'))) {
      canUpdate = true;
      updateMode = 'source-direct';
    } else {
      updateBlockedReason = '源码安装目录没有 .git，无法自动拉取更新';
    }
  } else {
    updateBlockedReason = '未识别安装方式，无法自动更新';
  }

  const statusLabel = latestError
    ? '检测失败'
    : hasUpdate
      ? '发现新版本'
      : currentRevision
        ? '已是最新版'
        : '当前版本未知';

  return {
    install,
    currentRevision,
    latestRevision,
    currentShort: shortRevision(currentRevision),
    latestShort: shortRevision(latestRevision),
    hasUpdate,
    canUpdate,
    updateMode,
    updateBlockedReason,
    statusLabel,
    latestError,
    runtime,
  };
}

function writeRuntimeStatus(dataDir, status) {
  writeJsonAtomic(path.join(dataDir, STATUS_FILENAME), {
    ...status,
    updated_at: new Date().toISOString(),
  });
}

function startSourceUpdate({ cwd, dataDir, env, targetRevision, requestId }) {
  const command = env.SELF_UPDATE_SOURCE_COMMAND || 'git pull --ff-only origin master && npm install --omit=dev';
  appendLog(dataDir, `source update started request=${requestId} target=${targetRevision || 'latest'}`);
  writeRuntimeStatus(dataDir, {
    worker_ready: true,
    status: 'running',
    message: '源码更新正在执行',
    started_at: new Date().toISOString(),
    request_id: requestId,
    target_revision: targetRevision || null,
  });

  const logFile = path.join(dataDir, LOG_FILENAME);
  fs.mkdirSync(dataDir, { recursive: true });
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  child.on('exit', (code) => {
    try { fs.closeSync(logFd); } catch {}
    const ok = code === 0;
    appendLog(dataDir, `source update finished request=${requestId} code=${code}`);
    writeRuntimeStatus(dataDir, {
      worker_ready: true,
      status: ok ? 'success' : 'failed',
      message: ok ? '源码已更新，进程重启后生效' : `源码更新失败，退出码 ${code}`,
      finished_at: new Date().toISOString(),
      request_id: requestId,
      target_revision: targetRevision || null,
    });
    const restartCommand = env.SELF_UPDATE_RESTART_COMMAND;
    if (ok && restartCommand) {
      try {
        const restart = spawn(restartCommand, { cwd, env, shell: true, detached: true, stdio: 'ignore' });
        restart.unref();
      } catch {}
    }
  });
}

async function requestSelfUpdate(options = {}) {
  const cwd = options.cwd || path.join(__dirname, '..');
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const env = options.env || process.env;
  const status = await buildUpdateStatus({ ...options, cwd, dataDir, env });
  if (!status.canUpdate) {
    throw new Error(status.updateBlockedReason || '当前无法执行自动更新');
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const request = {
    id,
    requested_at: new Date().toISOString(),
    install_type: status.install.type,
    update_mode: status.updateMode,
    current_revision: status.currentRevision || null,
    target_revision: status.latestRevision || null,
  };

  if (status.updateMode === 'docker-worker') {
    writeJsonAtomic(path.join(dataDir, REQUEST_FILENAME), request);
    writeRuntimeStatus(dataDir, {
      worker_ready: true,
      status: 'queued',
      message: '更新请求已提交，等待宿主机执行器处理',
      request_id: id,
      target_revision: status.latestRevision || null,
    });
    appendLog(dataDir, `docker worker request queued id=${id} target=${status.latestRevision || 'latest'}`);
    return { queued: true, id, mode: status.updateMode };
  }

  if (status.updateMode === 'source-direct') {
    startSourceUpdate({ cwd, dataDir, env, targetRevision: status.latestRevision, requestId: id });
    return { queued: false, started: true, id, mode: status.updateMode };
  }

  throw new Error('不支持的更新方式');
}

module.exports = {
  REQUEST_FILENAME,
  STATUS_FILENAME,
  LOG_FILENAME,
  buildUpdateStatus,
  detectInstallType,
  fetchLatestRevision,
  getCurrentRevision,
  getRuntimeStatus,
  requestSelfUpdate,
  shortRevision,
};
