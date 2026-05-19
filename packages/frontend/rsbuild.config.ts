import path from 'node:path';
import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';

const { publicVars, parsed } = loadEnv({ prefixes: ['PUBLIC_'] });

const devServerPort = Number(parsed.PORT) || 21456;
const backendBaseUrl =
  parsed.PUBLIC_BACKEND_BASE_URL || 'http://localhost:3001';

export default defineConfig({
  // @aiostreams/core resolves via its built dist (self-consistent .js
  // specifiers) — no relative-import aliasing needed. Node globals it touches
  // (Buffer, process, ...) are polyfilled for the browser; Next provided these
  // automatically, Rspack does not.
  plugins: [pluginReact(), pluginNodePolyfill()],
  source: {
    entry: { index: './src/main.tsx' },
    define: {
      // Transitional shim: components still read process.env.NEXT_PUBLIC_PLATFORM.
      // Final rename to import.meta.env.PUBLIC_PLATFORM happens in cleanup.
      'process.env.NEXT_PUBLIC_PLATFORM': JSON.stringify(
        parsed.PUBLIC_PLATFORM ?? parsed.NEXT_PUBLIC_PLATFORM ?? ''
      ),
      ...publicVars,
    },
  },
  html: {
    template: './index.html',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  output: {
    // Emit hashed assets under /assets/* (not the Rsbuild default /static/*),
    // because the Express server already serves /static/* for its .mp4 error
    // videos. /assets/* is content-hashed and gets immutable caching server-side.
    distPath: {
      root: 'dist',
      js: 'assets/js',
      jsAsync: 'assets/js/async',
      css: 'assets/css',
      cssAsync: 'assets/css/async',
      font: 'assets/font',
      image: 'assets/image',
      media: 'assets/media',
      svg: 'assets/svg',
      wasm: 'assets/wasm',
    },
  },
  server: {
    port: devServerPort,
    proxy: {
      '/api': backendBaseUrl,
    },
  },
  tools: {
    // Root-absolute url() references in CSS (e.g. url(/pattern-3.svg)) point at
    // public assets served by the Express server at the site root. Don't try to
    // resolve/bundle them — leave the absolute URL untouched, as Next did.
    cssLoader: {
      url: {
        filter: (url: string) => !url.startsWith('/'),
      },
    },
    rspack: {
      resolve: {
        fallback: { fs: false },
      },
    },
  },
});
