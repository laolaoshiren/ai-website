const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('one-click install script provisions a standalone Docker deployment', () => {
  const scriptPath = path.join(root, 'install.sh');
  assert.equal(fs.existsSync(scriptPath), true, 'install.sh should exist at the repository root');

  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /^#!\/usr\/bin\/env bash/);
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /https:\/\/get\.docker\.com/);
  assert.match(script, /ghcr\.io\/laolaoshiren\/ai-website:\$\{IMAGE_TAG:-latest\}/);
  assert.match(script, /read -r -p "是否需要自动设置反代域名/);
  assert.match(script, /留空则跳过/);
  assert.match(script, /image: caddy:2-alpine/);
  assert.match(script, /reverse_proxy ai-website:3000/);
  assert.match(script, /127\.0\.0\.1:\$\{APP_PORT:-3001\}:3000/);
  assert.match(script, /0\.0\.0\.0:\$\{APP_PORT:-3001\}:3000/);
  assert.match(script, /docker compose pull/);
  assert.match(script, /docker compose up -d --force-recreate/);
  assert.match(script, /AI_WEBSITE_INSTALL_TYPE=docker/);
  assert.match(script, /install-self-update-worker\.sh/);
  assert.doesNotMatch(script, /--domain/);
  assert.doesNotMatch(script, /--ai-key/);
  assert.doesNotMatch(script, /AI_API_KEY/);
});

test('readme starts with the one-command server install instruction', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const firstInstallSection = readme.indexOf('## 🚀 一键安装');
  const featureSection = readme.indexOf('## ✨ 核心特性');

  assert.ok(firstInstallSection > 0, 'README should include a one-click install section near the top');
  assert.ok(firstInstallSection < featureSection, 'install command should appear before the feature overview');
  assert.match(readme, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/laolaoshiren\/ai-website\/master\/install\.sh \| sudo bash/);
  assert.doesNotMatch(readme, /install\.sh \| sudo bash[^\n]*--/);
  assert.doesNotMatch(readme, /--ai-key/);
  assert.match(readme, /运行后只会询问是否需要自动设置反代域名/);
});

test('shell scripts keep Linux line endings in git', () => {
  const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /\*\.sh text eol=lf/);
});

test('self-update worker installer runs docker compose updates from the host', () => {
  const installerPath = path.join(root, 'scripts', 'install-self-update-worker.sh');
  assert.equal(fs.existsSync(installerPath), true, 'worker installer should exist');

  const installer = fs.readFileSync(installerPath, 'utf8');
  assert.match(installer, /^#!\/usr\/bin\/env bash/);
  assert.match(installer, /self-update-request\.json/);
  assert.match(installer, /self-update-status\.json/);
  assert.match(installer, /docker compose pull/);
  assert.match(installer, /docker compose up -d --force-recreate/);
  assert.match(installer, /systemctl enable --now ai-website-self-update\.timer/);
  assert.match(installer, /\/etc\/cron\.d\/ai-website-self-update/);
});
