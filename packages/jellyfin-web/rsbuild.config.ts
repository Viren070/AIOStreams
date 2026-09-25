import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const { parsed } = loadEnv({ prefixes: ['PUBLIC_'] });

/**
 * The commit this build comes from, e.g. `a1b2c3d4 (2026-09-25)`: from git, or
 * from the metadata CI writes where there is none, as in the Docker build.
 */
function buildCommit(): string {
  try {
    const [hash, date] = execFileSync(
      'git',
      ['log', '-1', '--format=%h%n%cs', '--abbrev=8'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .trim()
      .split('\n');
    if (hash) return `${hash} (${date})`;
  } catch {}
  try {
    const { commitHash, commitTime } = JSON.parse(
      readFileSync(
        new URL('../../resources/metadata.json', import.meta.url),
        'utf8'
      )
    ) as { commitHash?: string; commitTime?: string };
    if (commitHash && commitHash !== 'unknown')
      return commitTime
        ? `${commitHash} (${commitTime.slice(0, 10)})`
        : commitHash;
  } catch {}
  return 'unknown';
}

const devServerPort = Number(parsed.PORT) || 21459;
const backendBaseUrl =
  parsed.PUBLIC_BACKEND_BASE_URL || 'http://localhost:3001';

/** The page is served from every mount's `/web`, so its assets need one absolute home. */
const ASSET_PREFIX = '/jellyfin-web/';

const WEB_PAGE = /^\/jellyfin(\/.*)?\/web(\/(index\.html)?)?(\?|$)/i;

/** The icons a server would otherwise serve from its root. */
const BUNDLED_ICONS = [
  'logo.png',
  'favicon.ico',
  'icon0.svg',
  'apple-icon.png',
].map((name) => ({ from: `../frontend/public/${name}`, to: name }));

/**
 * `--env-mode standalone` builds the app on its own, with a server list,
 * instead of the copy each server hosts at `/web`.
 */
export default defineConfig(({ envMode }) => {
  const standalone = envMode === 'standalone';
  const define = {
    // Read by @aiostreams/ui components.
    'process.env.NEXT_PUBLIC_PLATFORM': JSON.stringify(''),
    __STANDALONE__: JSON.stringify(standalone),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
  };
  if (standalone) {
    return {
      plugins: [pluginReact()],
      source: { entry: { index: './src/main.tsx' }, define },
      html: { template: './index.html' },
      output: {
        distPath: { root: 'dist-standalone' },
        copy: BUNDLED_ICONS,
      },
      server: { port: devServerPort + 1 },
    };
  }
  return {
    plugins: [pluginReact()],
    source: { entry: { index: './src/main.tsx' }, define },
    html: { template: './index.html' },
    output: { assetPrefix: ASSET_PREFIX },
    dev: { assetPrefix: ASSET_PREFIX },
    server: {
      port: devServerPort,
      proxy: {
        '/api': backendBaseUrl,
        '/jellyfin': {
          target: backendBaseUrl,
          // The context matches by prefix, so it also catches this app's own assets.
          bypass: (req) => {
            const url = req.url ?? '';
            if (url.startsWith(ASSET_PREFIX)) return url;
            return WEB_PAGE.test(url) ? '/index.html' : undefined;
          },
        },
        '/logo.png': backendBaseUrl,
        '/favicon.ico': backendBaseUrl,
        '/icon0.svg': backendBaseUrl,
        '/apple-icon.png': backendBaseUrl,
      },
    },
  };
});
