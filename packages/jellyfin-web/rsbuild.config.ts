import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const { parsed } = loadEnv({ prefixes: ['PUBLIC_'] });

const devServerPort = Number(parsed.PORT) || 21459;
const backendBaseUrl =
  parsed.PUBLIC_BACKEND_BASE_URL || 'http://localhost:3001';

/** The page is served from every mount's `/web`, so its assets need one absolute home. */
const ASSET_PREFIX = '/jellyfin-web/';

const WEB_PAGE = /^\/jellyfin(\/.*)?\/web(\/(index\.html)?)?(\?|$)/i;

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: './src/main.tsx' },
    // Read by @aiostreams/ui components.
    define: { 'process.env.NEXT_PUBLIC_PLATFORM': JSON.stringify('') },
  },
  html: {
    template: './index.html',
  },
  output: {
    assetPrefix: ASSET_PREFIX,
  },
  dev: {
    assetPrefix: ASSET_PREFIX,
  },
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
});
