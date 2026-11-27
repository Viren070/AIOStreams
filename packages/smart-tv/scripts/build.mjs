// The manifests carry no version; package.json's is written in.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
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

// Both variants hold the same app, so only the resolution in the manifest
// differs.
const WEBOS_VARIANTS = [
  { resolution: '1920x1080', suffix: '' },
  { resolution: '1280x720', suffix: '-720p' },
];

if (platform === 'webos') {
  const requested = process.argv[3];
  const variants = requested
    ? WEBOS_VARIANTS.filter(({ resolution }) => resolution === requested)
    : WEBOS_VARIANTS;
  if (variants.length === 0) {
    console.error('Usage: node scripts/build.mjs webos [1920x1080|1280x720]');
    process.exit(1);
  }
  const stage = stageApp('appinfo.json', (text) => {
    const { id, ...rest } = JSON.parse(text);
    return JSON.stringify({ id, version, ...rest }, null, 2);
  });
  const cli = dirname(
    createRequire(import.meta.url).resolve('@webos-tools/cli/package.json')
  );
  const manifest = join(stage, 'appinfo.json');
  for (const { resolution, suffix } of variants) {
    const info = JSON.parse(readFileSync(manifest, 'utf8'));
    writeFileSync(manifest, JSON.stringify({ ...info, resolution }, null, 2));
    // ares-package names the file after the app id and version, so each variant
    // is packaged into its own folder and then renamed.
    const destination = join(out, `webos-package${suffix}`);
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    run(process.execPath, [
      join(cli, 'bin/ares-package.js'),
      stage,
      join(root, 'webos-service'),
      '--outdir',
      destination,
      '--no-minify',
    ]);
    const ipk = readdirSync(destination).find((name) => name.endsWith('.ipk'));
    if (!ipk) throw new Error(`No .ipk produced in ${destination}`);
    const file = join(out, `aiostreams-webos-${version}${suffix}.ipk`);
    rmSync(file, { force: true });
    renameSync(join(destination, ipk), file);
    rmSync(destination, { recursive: true, force: true });
  }
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
