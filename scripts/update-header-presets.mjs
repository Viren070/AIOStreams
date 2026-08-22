/**
 * Refreshes the version numbers baked into `HEADER_PRESETS`.
 *
 * Run with `--check` to fail instead of writing when something is stale.
 *
 * Three values drift separately:
 *   - the app version;
 *   - the `(alpine X.Y.Z)` suffix on the *arr presets, which is the OS the
 *     LinuxServer container reports.
 *   - Chrome's `Sec-Ch-Ua`, whose GREASE brand, version and ordering are all
 *     derived from the major version and change together.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRESETS_PATH = join(ROOT, 'packages/core/src/utils/header-presets.ts');
const CHECK_ONLY = process.argv.includes('--check');
const USER_AGENT = 'AIOStreams-header-preset-updater';

const report = { changes: [], skipped: [], errors: [] };

const skip = (target, reason) => {
  report.skipped.push({ target, reason });
  console.warn(`! ${target}: ${reason}`);
};

const fail = (target, reason) => {
  report.errors.push({ target, reason });
  console.error(`x ${target}: ${reason}`);
};

const githubHeaders = () => ({
  Accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
});

async function get(url, { headers = {}, target, json = true }) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      skip(target, `${url} returned ${response.status}`);
      return null;
    }
    return json ? await response.json() : await response.text();
  } catch (error) {
    skip(target, `${url} failed: ${error.message}`);
    return null;
  }
}

/** GitHub's own "latest" already excludes prereleases; don't re-derive it. */
async function latestGithubRelease(repo, target) {
  const release = await get(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers: githubHeaders(), target }
  );
  if (!release || typeof release.tag_name !== 'string') return null;
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+(?:\.\d+)*$/.test(version)) {
    skip(target, `tag "${release.tag_name}" is not a plain version`);
    return null;
  }
  return version;
}

async function alpineVersionFor(app) {
  const target = `${app} alpine`;
  const dockerfile = await get(
    `https://api.github.com/repos/linuxserver/docker-${app}/contents/Dockerfile`,
    { headers: githubHeaders(), target }
  );
  if (!dockerfile?.content) return null;
  const source = Buffer.from(dockerfile.content, 'base64').toString('utf8');
  const pinned = source.match(
    /^FROM\s+ghcr\.io\/linuxserver\/baseimage-alpine:([\w.]+)/m
  );
  if (!pinned) {
    skip(target, 'no baseimage-alpine pin in Dockerfile');
    return null;
  }
  const releases = await get(
    `https://dl-cdn.alpinelinux.org/alpine/v${pinned[1]}/releases/x86_64/latest-releases.yaml`,
    { target, json: false }
  );
  const version = releases?.match(/^\s*version:\s*([\d.]+)\s*$/m);
  if (!version) {
    skip(target, `no release listed for Alpine v${pinned[1]}`);
    return null;
  }
  return version[1];
}

async function chromeMajorVersion() {
  const history = await get(
    'https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions',
    { target: 'chrome' }
  );
  const version = history?.versions?.[0]?.version;
  if (typeof version !== 'string') {
    skip('chrome', 'version history returned no versions');
    return null;
  }
  return version.split('.')[0];
}

// Ported from Chromium `components/embedder_support/user_agent_utils.cc`
const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
const GREASE_VERSIONS = ['8', '99', '24'];
const BRAND_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function secChUa(major) {
  const seed = Number(major);
  const grease = `Not${GREASE_CHARS[seed % GREASE_CHARS.length]}A${
    GREASE_CHARS[(seed + 1) % GREASE_CHARS.length]
  }Brand`;
  const brands = [
    {
      brand: grease,
      version: GREASE_VERSIONS[seed % GREASE_VERSIONS.length],
    },
    { brand: 'Chromium', version: String(seed) },
    { brand: 'Google Chrome', version: String(seed) },
  ];
  const ordered = [];
  BRAND_ORDERS[seed % BRAND_ORDERS.length].forEach((destination, index) => {
    ordered[destination] = brands[index];
  });
  return ordered.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
}

const GREASE_FIXTURE =
  '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"';
if (secChUa(143) !== GREASE_FIXTURE) {
  console.error('x grease: Sec-Ch-Ua port no longer reproduces Chrome 143');
  console.error(`  expected ${GREASE_FIXTURE}`);
  console.error(`  actual   ${secChUa(143)}`);
  process.exit(1);
}

function presetBlock(content, preset) {
  const match = content.match(
    new RegExp(`(\\r?\\n  ${preset}: \\{\\r?\\n)([\\s\\S]*?)(\\r?\\n  \\},)`)
  );
  if (!match) fail(preset, 'preset block not found in header-presets.ts');
  return match;
}

function edit(content, preset, field, pattern, next) {
  if (next == null) return content;
  const block = presetBlock(content, preset);
  if (!block) return content;
  const body = block[2];
  const found = body.match(pattern);
  if (!found) {
    fail(`${preset}.${field}`, `pattern ${pattern} not found`);
    return content;
  }
  const current = found[1];
  if (current === next) return content;
  const updated = body.replace(pattern, (whole, captured) => {
    const at = whole.indexOf(captured);
    return whole.slice(0, at) + next + whole.slice(at + captured.length);
  });
  report.changes.push({ preset, field, from: current, to: next });
  return (
    content.slice(0, block.index) +
    block[1] +
    updated +
    block[3] +
    content.slice(block.index + block[0].length)
  );
}

const ARR = {
  sonarr: { repo: 'Sonarr/Sonarr', pattern: /Sonarr\/([\d.]+)/ },
  radarr: { repo: 'Radarr/Radarr', pattern: /Radarr\/([\d.]+)/ },
  prowlarr: { repo: 'Prowlarr/Prowlarr', pattern: /Prowlarr\/([\d.]+)/ },
};

let content = readFileSync(PRESETS_PATH, 'utf8');

const [sabnzbd, nzbget, nzbhydra2, chromeMajor, ...arr] = await Promise.all([
  latestGithubRelease('sabnzbd/sabnzbd', 'sabnzbd'),
  latestGithubRelease('nzbgetcom/nzbget', 'nzbget'),
  latestGithubRelease('theotherp/nzbhydra2', 'nzbhydra2'),
  chromeMajorVersion(),
  ...Object.entries(ARR).flatMap(([app, spec]) => [
    latestGithubRelease(spec.repo, app),
    alpineVersionFor(app),
  ]),
]);

content = edit(content, 'sabnzbd', 'version', /SABnzbd\/([\d.]+)/, sabnzbd);
content = edit(content, 'nzbget', 'version', /nzbget\/([\d.]+)/, nzbget);
content = edit(
  content,
  'nzbhydra2',
  'version',
  /NZBHydra2 ([\d.]+)/,
  nzbhydra2
);

Object.keys(ARR).forEach((app, index) => {
  content = edit(content, app, 'version', ARR[app].pattern, arr[index * 2]);
  content = edit(
    content,
    app,
    'alpine',
    /\(alpine ([\d.]+)\)/,
    arr[index * 2 + 1]
  );
});

if (chromeMajor) {
  content = edit(
    content,
    'chrome',
    'version',
    /Chrome\/(\d+)\.0\.0\.0/,
    chromeMajor
  );
  content = edit(
    content,
    'chrome',
    'sec-ch-ua',
    /'Sec-Ch-Ua':\s*'([^']*)'/,
    secChUa(chromeMajor)
  );
}

const lines = [];
if (report.changes.length) {
  lines.push('Updated header presets:', '');
  lines.push('| Preset | Field | Old | New |');
  lines.push('| --- | --- | --- | --- |');
  for (const change of report.changes) {
    lines.push(
      `| \`${change.preset}\` | ${change.field} | \`${change.from}\` | \`${change.to}\` |`
    );
  }
} else {
  lines.push('All header presets are already up to date.');
}
if (report.skipped.length) {
  lines.push('', 'Skipped (unresolved, left unchanged):', '');
  for (const item of report.skipped) {
    lines.push(`- \`${item.target}\`: ${item.reason}`);
  }
}

const summary = lines.join('\n');
console.log(summary);

if (report.errors.length) {
  console.error('\nAborting without writing: header-presets.ts did not match.');
  process.exit(1);
}

if (report.changes.length) {
  if (CHECK_ONLY) {
    console.error('\n--check: header presets are stale.');
    process.exit(1);
  }
  writeFileSync(PRESETS_PATH, content);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
}
if (process.env.PR_BODY_FILE && report.changes.length) {
  writeFileSync(process.env.PR_BODY_FILE, summary);
}
