/// <reference types="@rsbuild/core/types" />

/** True in the standalone build, which picks its server instead of being served by one. */
declare const __STANDALONE__: boolean;

/** The commit this build comes from, with its date. */
declare const __APP_COMMIT__: string;

/** The list of the npm packages in the bundle and their licences, under the public path. */
declare const __LICENSES_FILE__: string;

declare let __webpack_public_path__: string;

/** WebGPU-Player's embedding module, under the public path. */
declare const __WEBGPU_PLAYER_MODULE__: string;

/** The version of the app this page ships in, where the app can't say it; null otherwise. */
declare const __APP_VERSION__: string | null;

/** Where the apps send their usage statistics, or null for a build that sends none. */
declare const __USAGE_STATS__: { appKey: string; host: string } | null;

/** Languages with a catalog too little translated to offer. */
declare const __UNFINISHED_LOCALES__: string[];

/** A WebGPU-Player pass file's text. */
declare module '*.wgsl' {
  const source: string;
  export default source;
}

/** hls.js without subtitles, extra audio or DRM, which ships no types of its own. */
declare module 'hls.js/light' {
  export { default } from 'hls.js';
  export * from 'hls.js';
}

/** A translation catalog, compiled by `@lingui/loader`. */
declare module '*.po' {
  import type { Messages } from '@lingui/core';
  export const messages: Messages;
}
