import { config } from '../config/index.js';
import { StreamType } from './constants.js';

const DEFAULT_REASON = 'Disabled by owner of the instance';

function parseReasonMap(input: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, reason] of Object.entries(input)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    map.set(trimmedKey, reason?.trim() || DEFAULT_REASON);
  }
  return map;
}

/**
 * Manages instance-level feature controls:
 *   - Disabled hosts, addons, services, and stream types
 *   - Regex filter access level
 *
 * All values are derived from the live runtime config snapshot, so changes via
 * the settings UI are picked up after a `settingsStore.refreshIfChanged()`.
 */
export class FeatureControl {
  public static get disabledHosts(): Map<string, string> {
    return parseReasonMap(config.userLimits.disabled.hosts);
  }

  public static get disabledAddons(): Map<string, string> {
    return parseReasonMap(config.userLimits.disabled.addons);
  }

  public static get removedAddons(): Map<string, string> {
    return parseReasonMap(config.userLimits.disabled.removedAddons);
  }

  public static get disabledServices(): Map<string, string> {
    return parseReasonMap(config.userLimits.disabled.services);
  }

  public static get disabledStreamTypes(): Set<StreamType> {
    return new Set(config.userLimits.disabled.streamTypes as StreamType[]);
  }

  public static get regexFilterAccess(): 'none' | 'trusted' | 'all' {
    return config.userLimits.regex.access;
  }
}
