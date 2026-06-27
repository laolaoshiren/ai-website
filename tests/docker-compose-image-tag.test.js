const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('docker compose supports IMAGE_TAG rollback while defaulting to latest', () => {
  const compose = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
  assert.match(compose, /ghcr\.io\/laolaoshiren\/ai-website:\$\{IMAGE_TAG:-latest\}/);
});
