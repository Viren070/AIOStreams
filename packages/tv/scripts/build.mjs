// The manifests carry no version; package.json's is written in.
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const platform = process.argv[2];
const { version } = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8')
);
const out = join(root, 'out');

function run(command, args, options = {}) {
  const { status, error } = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}

function stageApp(manifest, withVersion) {
  const stage = join(out, platform);
  rmSync(stage, { recursive: true, force: true });
  cpSync(join(root, '../jellyfin-web/dist-standalone'), stage, {
    recursive: true,
  });
  cpSync(join(root, platform), stage, { recursive: true });
  const file = join(stage, manifest);
  writeFileSync(file, withVersion(readFileSync(file, 'utf8')));
  return stage;
}

if (platform === 'webos') {
  const stage = stageApp('appinfo.json', (text) => {
    const { id, ...rest } = JSON.parse(text);
    return JSON.stringify({ id, version, ...rest }, null, 2);
  });
  const cli = dirname(
    createRequire(import.meta.url).resolve('@webos-tools/cli/package.json')
  );
  run(process.execPath, [
    join(cli, 'bin/ares-package.js'),
    stage,
    '--outdir',
    out,
    '--no-minify',
  ]);
} else if (platform === 'tizen') {
  const profile = process.env.TIZEN_PROFILE;
  if (!profile) {
    console.error('Set TIZEN_PROFILE to a Tizen security profile (README.md).');
    process.exit(1);
  }
  const stage = stageApp('config.xml', (text) =>
    text.replace('<widget ', `<widget version="${version}" `)
  );
  // The CLI resolves relative paths against its own folder. On Windows it is a
  // batch file, so it runs in a shell, which needs the paths quoted.
  const shell = process.platform === 'win32';
  const path = (p) => (shell ? `"${p}"` : p);
  run(
    'tizen',
    ['package', '-t', 'wgt', '-s', profile, '-o', path(out), '--', path(stage)],
    { shell }
  );
} else {
  console.error('Usage: node scripts/build.mjs <webos|tizen>');
  process.exit(1);
}
