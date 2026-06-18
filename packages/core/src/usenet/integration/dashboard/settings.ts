import { settingsStore, describeSettings } from '../../../config/index.js';
import { createLogger } from '../../../logging/logger.js';
// Re-exported so the dashboard route + frontend can show the concrete values
// each performance profile applies (single source of truth lives in the schema).
export { PERFORMANCE_PROFILES } from '../../../config/schema/usenet.js';

const logger = createLogger('usenet/dashboard');

/**
 * One usenet engine setting + metadata + current value, in the same shape the
 * generic settings page consumes, but served by the usenet dashboard so the
 * (intentionally `ui.hidden`) engine knobs live in one bespoke editor on the
 * usenet page instead of the generic settings page. Excludes `usenet.providers`
 * (its own editor) and never echoes secret values.
 */
export interface UsenetSettingDescriptor {
  key: string;
  label: string;
  description: string;
  env: string | null;
  requiresRestart: boolean;
  secret: boolean;
  valueType: string;
  default: unknown;
  source: string;
  value: unknown;
  secretSet: boolean;
  ui: unknown;
}

const USENET_SETTINGS_MASK = '';

function isManagedUsenetKey(key: string): boolean {
  return key.startsWith('usenet.') && key !== 'usenet.providers';
}

/** Every editable usenet engine setting (incl. the hidden ones) with its value. */
export function getUsenetSettings(): UsenetSettingDescriptor[] {
  const hints = describeSettings();
  return settingsStore.metadata
    .filter((m) => isManagedUsenetKey(m.key))
    .map((m) => {
      let value: unknown;
      try {
        value = settingsStore.getEffectiveValue(m.key);
      } catch {
        value = m.default;
      }
      const secretSet =
        m.secret && m.source !== 'default' && value !== '' && value != null;
      return {
        ...m,
        ui: hints[m.key] ?? { kind: 'json' },
        value: m.secret ? USENET_SETTINGS_MASK : value,
        secretSet,
      };
    });
}

/** Persist a patch of usenet engine settings (dotted-key → value). */
export async function saveUsenetSettings(
  patch: Record<string, unknown>,
  username: string
): Promise<{
  updated: string[];
  requiresRestart: boolean;
  errors: Record<string, string>;
}> {
  const updated: string[] = [];
  const errors: Record<string, string> = {};
  let requiresRestart = false;
  const meta = new Map(settingsStore.metadata.map((m) => [m.key, m]));
  for (const [key, value] of Object.entries(patch)) {
    if (!isManagedUsenetKey(key)) {
      errors[key] = 'Not a usenet engine setting';
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
      await settingsStore.set(key, value, username);
      updated.push(key);
      if (m.requiresRestart) requiresRestart = true;
    } catch (err) {
      errors[key] = err instanceof Error ? err.message : 'Invalid value';
    }
  }
  if (updated.length)
    logger.info({ updated, username }, 'usenet settings updated');
  return { updated, requiresRestart, errors };
}
