const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildUpdateStatus,
  detectInstallType,
  requestSelfUpdate,
  shortRevision,
} = require('../utils/self-update');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-site-update-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

test('detectInstallType prefers docker marker over source checkout', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, '.git'));
  const dockerenvPath = path.join(root, '.dockerenv');
  fs.writeFileSync(dockerenvPath, '');

  const result = detectInstallType({ cwd: root, dockerenvPath });

  assert.equal(result.type, 'docker');
  assert.equal(result.label, 'Docker');
});

test('buildUpdateStatus enables docker web update only when host worker is ready', async () => {
  const root = tempDir();
  const dataDir = path.join(root, 'data');
  const statusFile = path.join(dataDir, 'self-update-status.json');
  const current = '1111111111111111111111111111111111111111';
  const latest = '2222222222222222222222222222222222222222';

  writeJson(statusFile, {
    worker_ready: true,
    status: 'idle',
    updated_at: new Date().toISOString(),
  });

  const status = await buildUpdateStatus({
    cwd: root,
    dataDir,
    dockerenvPath: path.join(root, '.dockerenv-missing'),
    env: { AI_WEBSITE_INSTALL_TYPE: 'docker', APP_REVISION: current },
    latestRevisionProvider: async () => latest,
  });

  assert.equal(status.install.type, 'docker');
  assert.equal(status.currentRevision, current);
  assert.equal(status.latestRevision, latest);
  assert.equal(status.currentShort, shortRevision(current));
  assert.equal(status.latestShort, shortRevision(latest));
  assert.equal(status.hasUpdate, true);
  assert.equal(status.canUpdate, true);
  assert.equal(status.updateMode, 'docker-worker');
});

test('buildUpdateStatus reports docker worker unavailable without opening update button', async () => {
  const root = tempDir();
  const dataDir = path.join(root, 'data');

  const status = await buildUpdateStatus({
    cwd: root,
    dataDir,
    env: {
      AI_WEBSITE_INSTALL_TYPE: 'docker',
      APP_REVISION: '1111111111111111111111111111111111111111',
    },
    latestRevisionProvider: async () => '2222222222222222222222222222222222222222',
  });

  assert.equal(status.install.type, 'docker');
  assert.equal(status.hasUpdate, true);
  assert.equal(status.canUpdate, false);
  assert.equal(status.updateMode, 'unavailable');
  assert.match(status.updateBlockedReason, /执行器/);
});

test('requestSelfUpdate writes a docker worker request with target revision', async () => {
  const root = tempDir();
  const dataDir = path.join(root, 'data');
  writeJson(path.join(dataDir, 'self-update-status.json'), {
    worker_ready: true,
    status: 'idle',
    updated_at: new Date().toISOString(),
  });

  const result = await requestSelfUpdate({
    cwd: root,
    dataDir,
    env: { AI_WEBSITE_INSTALL_TYPE: 'docker', APP_REVISION: '1111111111111111111111111111111111111111' },
    latestRevisionProvider: async () => '2222222222222222222222222222222222222222',
  });

  const request = JSON.parse(fs.readFileSync(path.join(dataDir, 'self-update-request.json'), 'utf8'));
  assert.equal(result.queued, true);
  assert.equal(request.id, result.id);
  assert.equal(request.target_revision, '2222222222222222222222222222222222222222');
  assert.equal(request.install_type, 'docker');
});
