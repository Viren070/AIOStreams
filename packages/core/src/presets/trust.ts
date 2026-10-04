import type { Addon } from '../db/schemas.js';
import { PresetManager } from './presetManager.js';

/** External addons whose info hashes and file names we take at their word. */
const TRUSTED_EXTERNAL_PRESETS = new Set([
  'torrentio',
  'comet',
  'mediafusion',
  'stremthruTorz',
  'stremthruStore',
  'debridio',
  'meteor',
]);

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

// Every stream of an addon shares its object, and building a preset's
// metadata is not cheap, so each addon is judged once.
const judged = new WeakMap<Addon, boolean>();

/**
 * Whether an addon's info hashes can key stored media info. Built-ins are
 * ours; an external preset counts only on one of this instance's URLs for
 * it, as a custom URL could answer anything.
 */
export function isTrustedAddon(addon: Addon | undefined): boolean {
  if (!addon) return false;
  let trusted = judged.get(addon);
  if (trusted === undefined) {
    trusted = judge(addon);
    judged.set(addon, trusted);
  }
  return trusted;
}

function judge(addon: Addon): boolean {
  const type = addon.preset?.type;
  if (!type) return false;
  let preset;
  try {
    preset = PresetManager.fromId(type);
  } catch {
    return false;
  }
  const metadata = preset.METADATA;
  if (metadata.BUILTIN) return true;
  if (!TRUSTED_EXTERNAL_PRESETS.has(metadata.ID)) return false;
  const origin = originOf(addon.manifestUrl);
  return !!origin && metadata.URL.some((url) => originOf(url) === origin);
}
