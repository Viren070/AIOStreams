import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type RsbuildConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import type { AcceptedPlugin } from 'postcss';
import legacyCss from './legacy-css.js';

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

/** Tizen 6.0's Chromium; Tizen 6.5 has 85. */
const TIZEN6_BROWSERS = ['chrome >= 76'];

type PostcssUtils = { addPlugins: (plugins: AcceptedPlugin[]) => void };

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
  // `--env-mode tizen6` is the standalone build for Tizen 6 TVs (Chromium 76
  // on 6.0, 85 on 6.5): lowered syntax, polyfills and CSS fallbacks.
  const tizen6 = envMode === 'tizen6';
  const standalone = envMode === 'standalone' || tizen6;
  // Read by autoprefixer in postcss.config.js as well as by Rsbuild.
  if (tizen6) process.env.BROWSERSLIST = TIZEN6_BROWSERS.join(',');
  const define = {
    // Read by @aiostreams/ui components.
    'process.env.NEXT_PUBLIC_PLATFORM': JSON.stringify(''),
    __STANDALONE__: JSON.stringify(standalone),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
  };
  const source = {
    entry: { index: './src/main.tsx' },
    define,
    // Dependencies too, which are otherwise shipped as published: older browsers can't parse some of their syntax.
    include: [/[\\/]node_modules[\\/]/],
    // Polyfilling core-js with itself breaks it.
    ...(tizen6 && { exclude: [/[\\/]node_modules[\\/]core-js[\\/]/] }),
  };
  // Lingui's macros compile at build time, and each catalog loads compiled.
  const tools: RsbuildConfig['tools'] = {
    swc: { jsc: { experimental: { plugins: [['@lingui/swc-plugin', {}]] } } },
    rspack: {
      module: { rules: [{ test: /\.po$/, use: '@lingui/loader' }] },
    },
  };
  if (standalone) {
    return {
      plugins: [pluginReact()],
      source,
      tools,
      html: {
        template: './index.html',
        templateParameters: { root: './', icons: false },
      },
      output: {
        distPath: { root: tizen6 ? 'dist-tizen6' : 'dist-standalone' },
        // Relative, since the TV apps load it from their package's files.
        assetPrefix: 'auto',
        copy: BUNDLED_ICONS,
        ...(tizen6 && {
          overrideBrowserslist: TIZEN6_BROWSERS,
          polyfill: 'usage' as const,
        }),
      },
      ...(tizen6 && {
        tools: {
          ...tools,
          swc: {
            ...tools.swc,
            // Chromium 84 parses private methods, but SWC's tables leave them in.
            env: {
              include: [
                'transform-private-methods',
                'transform-class-properties',
                'transform-private-property-in-object',
              ],
            },
          },
          postcss: (_: unknown, { addPlugins }: PostcssUtils) =>
            addPlugins(legacyCss()),
        },
      }),
      server: { port: devServerPort + 1 },
    };
  }
  return {
    plugins: [pluginReact()],
    source,
    tools,
    html: {
      template: './index.html',
      templateParameters: { root: '/', icons: true },
    },
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
