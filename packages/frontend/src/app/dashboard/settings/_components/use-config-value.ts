import { useFormContext } from 'react-hook-form';
import { useSettings } from '../queries';
import { toName } from './settings-field';

/**
 * A config value as the user currently sees it: the unsaved form edit when
 * rendered inside the settings form, else the stored value. Bespoke panels
 * render outside the form, so for them this is always the stored value.
 */
export function useConfigValue(key: string): string {
  const form = useFormContext();
  const settings = useSettings();
  const live = form?.watch?.(toName(key));
  if (typeof live === 'string' && live) return live;
  if (typeof live === 'boolean' || typeof live === 'number')
    return String(live);
  const stored = settings.data?.keys.find((k) => k.key === key)?.value;
  if (typeof stored === 'boolean' || typeof stored === 'number')
    return String(stored);
  return typeof stored === 'string' ? stored : '';
}
