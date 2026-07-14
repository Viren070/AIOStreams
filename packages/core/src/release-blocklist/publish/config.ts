import { encryptString, decryptString } from '../../utils/crypto.js';

/**
 * The whole provider config is stored as one encrypted JSON blob because it
 * carries credentials (tokens). Decode failure returns undefined so a
 * SECRET_KEY rotation degrades to a re-enter-config error instead of a crash.
 */
export function encodePublishConfig(config: Record<string, unknown>): string {
  const enc = encryptString(JSON.stringify(config));
  if (!enc.success) {
    throw new Error('failed to encrypt publish target config');
  }
  return enc.data;
}

export function decodePublishConfig(
  configEnc: string
): Record<string, unknown> | undefined {
  const dec = decryptString(configEnc);
  if (!dec.success || dec.data == null) return undefined;
  try {
    const parsed = JSON.parse(dec.data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Merge a config PATCH into the stored config. The snapshot never echoes
 * secrets, so the UI round-trips placeholders: an omitted or empty `token`
 * keeps the stored one, while an empty `gistId` explicitly clears it (the
 * next push then creates a fresh gist).
 */
export function applyConfigPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    if (key === 'token' && typeof value === 'string') {
      if (value !== '') merged.token = value;
      continue;
    }
    if (key === 'gistId' && value === '') {
      delete merged[key];
      continue;
    }

    merged[key] = value;
  }
  return merged;
}
