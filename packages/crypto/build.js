// A failed build must not fail the workspace build; consumers fall back to
// node:crypto.
'use strict';
const { spawnSync } = require('child_process');

const r = spawnSync('node-gyp', ['rebuild'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
});
if (r.status !== 0) {
  console.warn('[crypto] native build failed (exit %s); falling back to node:crypto', r.status);
}
process.exit(0);
