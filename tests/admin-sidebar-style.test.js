const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin sidebar navigation centers menu text and keeps active items stable', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

  assert.match(css, /\.sidebar-header \{[^}]*justify-content:\s*center/s);
  assert.match(css, /\.sidebar-link \{[^}]*justify-content:\s*center/s);
  assert.match(css, /\.sidebar-link \{[^}]*min-height:\s*46px/s);
  assert.match(css, /\.sidebar-link \{[^}]*text-align:\s*center/s);
  assert.match(css, /\.sidebar-link\.active \{[^}]*box-shadow:/s);
});
