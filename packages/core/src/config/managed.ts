import { ZodError } from 'zod';
import { settingsStore } from './index.js';
import { formatZodError } from '../utils/format-zod-error.js';

export interface ManagedSettingsPatchResult {
  updated: string[];
  requiresRestart: boolean;
  /** Keyed by the dotted setting key that could not be written. */
  errors: Record<string, string>;
}

/**
 * Persist a patch of `ui.hidden` settings on behalf of a bespoke editor. `isManaged` is that
 * editor's key whitelist: keys outside it are refused rather than written, so
 * one editor can never reach another's fields, and env-locked keys are refused
 * exactly as the generic settings page refuses them.
 */
export async function saveManagedSettings(
  patch: Record<string, unknown>,
  options: {
    isManaged: (key: string) => boolean;
    username: string;
    /** Refusal reason for keys outside the editor's whitelist. */
    unmanagedMessage: string;
  }
): Promise<ManagedSettingsPatchResult> {
  const updated: string[] = [];
  const errors: Record<string, string> = {};
  let requiresRestart = false;
  const meta = new Map(settingsStore.metadata.map((m) => [m.key, m]));

  for (const [key, value] of Object.entries(patch)) {
    if (!options.isManaged(key)) {
      errors[key] = options.unmanagedMessage;
      continue;
    }
    const m = meta.get(key);
    if (!m) {
      errors[key] = 'Unknown setting';
      continue;
    }
    if (m.source === 'environment') {
      errors[key] = `Overridden by ${m.env}`;
      continue;
    }
    try {
      await settingsStore.set(key, value, options.username);
      updated.push(key);
      if (m.requiresRestart) requiresRestart = true;
    } catch (err) {
      errors[key] =
        err instanceof ZodError
          ? formatZodError(err, { singleLine: true })
          : err instanceof Error
            ? err.message
            : 'Invalid value';
    }
  }

  return { updated, requiresRestart, errors };
}

/**
 * The environment variable currently owning each key, or `null` when the key is
 * DB- or default-backed. A bespoke editor uses this to lock the fields the
 * operator has pinned in the environment, which `saveManagedSettings` would
 * otherwise refuse only after they tried to save.
 */
export function settingEnvLocks<K extends string>(
  keys: readonly K[]
): Record<K, string | null> {
  const meta = new Map(settingsStore.metadata.map((m) => [m.key, m]));
  const locks = {} as Record<K, string | null>;
  for (const key of keys) {
    const m = meta.get(key);
    locks[key] = m?.source === 'environment' ? m.env : null;
  }
  return locks;
}
