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

/**
 * `web` is the web app's build, `dirs` the folders laid over it, `minimum` the
 * oldest TV boot.js lets by without a warning, `scripts` what runs after it.
 */
function stageApp(
  manifest,
  withVersion,
  { web = 'dist-standalone', dirs = [platform], minimum, scripts = [] } = {}
) {
  const stage = join(out, platform);
  rmSync(stage, { recursive: true, force: true });
  cpSync(join(root, '../web', web), stage, { recursive: true });
  for (const dir of dirs) cpSync(join(root, dir), stage, { recursive: true });
  let boot = readFileSync(join(root, 'boot.js'), 'utf8');
  if (minimum) {
    const line = /var MIN = {[^}]*};/;
    if (!line.test(boot)) throw new Error('boot.js has no MIN line');
    boot = boot.replace(line, `var MIN = ${JSON.stringify(minimum)};`);
  }
  writeFileSync(join(stage, 'boot.js'), boot);
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

function sign(stage, profile, dir = out) {
  // The CLI resolves relative paths against its own folder. On Windows it is a
  // batch file, so it runs in a shell, which needs the paths quoted.
  const shell = process.platform === 'win32';
  const path = (p) => (shell ? `"${p}"` : p);
  const args = ['package', '-t', 'wgt', '-s', profile, '-o', path(dir)];
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
} else if (platform === 'tizen' || platform === 'tizen6') {
  // The Tizen 6 package is the same app, built for Chromium 76 (web's
  // `build:tizen6`), with legacy.js filling in layout that engine lacks.
  const tizen6 = platform === 'tizen6';
  const stage = stageApp(
    'config.xml',
    (text) => text.replace('<widget ', `<widget version="${version}" `),
    tizen6
      ? {
          web: 'dist-tizen6',
          dirs: ['tizen', 'tizen6'],
          minimum: { chrome: 76, tizen: 6, year: 2021 },
          scripts: ['legacy.js', '$WEBAPIS/webapis/webapis.js'],
        }
      : { scripts: ['$WEBAPIS/webapis/webapis.js'] }
  );
  const profile = process.env.TIZEN_PROFILE;
  if (profile) sign(stage, profile, tizen6 ? join(out, 'tizen6-signed') : out);
  else
    writeUnsigned(
      stage,
      join(out, tizen6 ? 'AIOStreams-tizen6.wgt' : 'AIOStreams.wgt')
    );
} else {
  console.error('Usage: node scripts/build.mjs <webos|tizen|tizen6>');
  process.exit(1);
}
