// The manifests carry no version; package.json's is written in.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

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

function stageApp(manifest, withVersion, scripts = []) {
  const stage = join(out, platform);
  rmSync(stage, { recursive: true, force: true });
  cpSync(join(root, '../web/dist-standalone'), stage, {
    recursive: true,
  });
  cpSync(join(root, platform), stage, { recursive: true });
  cpSync(join(root, 'boot.js'), join(stage, 'boot.js'));
  const file = join(stage, manifest);
  writeFileSync(file, withVersion(readFileSync(file, 'utf8')));
  const index = join(stage, 'index.html');
  const tags = ['boot.js', ...scripts].map(
    (src) => `<script src="${src}"></script>`
  );
  writeFileSync(
    index,
    readFileSync(index, 'utf8').replace('<head>', `<head>${tags.join('')}`)
  );
  return stage;
}

function sign(stage, profile) {
  // The CLI resolves relative paths against its own folder. On Windows it is a
  // batch file, so it runs in a shell, which needs the paths quoted.
  const shell = process.platform === 'win32';
  const path = (p) => (shell ? `"${p}"` : p);
  const args = ['package', '-t', 'wgt', '-s', profile, '-o', path(out)];
  run('tizen', [...args, '--', path(stage)], { shell });
}

// Installers sign it for each TV with that TV's own certificate.
function writeUnsigned(stage, file) {
  const files = {};
  for (const name of readdirSync(stage, { recursive: true })) {
    const path = join(stage, name);
    if (statSync(path).isFile())
      files[name.split(sep).join('/')] = readFileSync(path);
  }
  writeFileSync(file, zipSync(files));
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
  const stage = stageApp(
    'config.xml',
    (text) => text.replace('<widget ', `<widget version="${version}" `),
    ['$WEBAPIS/webapis/webapis.js']
  );
  const profile = process.env.TIZEN_PROFILE;
  if (profile) sign(stage, profile);
  else writeUnsigned(stage, join(out, 'AIOStreams.wgt'));
} else {
  console.error('Usage: node scripts/build.mjs <webos|tizen>');
  process.exit(1);
}
