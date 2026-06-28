const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('docker workflow runs the test suite before publishing an image', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'docker.yml'), 'utf8');
  const testIndex = workflow.indexOf('npm test');
  const buildIndex = workflow.indexOf('docker/build-push-action');

  assert.ok(testIndex > 0, 'workflow should run npm test');
  assert.ok(buildIndex > 0, 'workflow should build and push the image');
  assert.ok(testIndex < buildIndex, 'tests must run before image publishing');
});

test('production Docker image includes runtime utility modules', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /COPY --from=builder \/app\/utils \.\/utils/, 'Dockerfile must copy utils into production image');
});
