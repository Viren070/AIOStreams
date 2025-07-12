import { Addon } from '../db/schemas';

export function getAddonName(addon: Addon): string {
  return `${addon.name}${addon.displayIdentifier || addon.identifier ? ` ${addon.displayIdentifier || addon.identifier}` : ''}`;
}
