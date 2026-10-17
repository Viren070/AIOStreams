/// <reference types="@rsbuild/core/types" />

/** True in the standalone build, which picks its server instead of being served by one. */
declare const __STANDALONE__: boolean;

/** The commit this build comes from, with its date. */
declare const __APP_COMMIT__: string;

/** A translation catalog, compiled by `@lingui/loader`. */
declare module '*.po' {
  import type { Messages } from '@lingui/core';
  export const messages: Messages;
}
