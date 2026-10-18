import type { AcceptedPlugin } from 'postcss';

/** The Tizen 6 build's CSS fallbacks, run after the config's own plugins. */
export default function legacyCss(): AcceptedPlugin[];
