import { usingKeys } from './dispatch';
import { isRepeating } from './glide';

/** Long enough for a held arrow to pass a tab without picking it. */
const REST_MS = 250;

let resting = 0;

/** A row of tabs, entered at the one picked. */
export const tabList = {
  role: 'tablist',
  'data-nav-enter': '[role=tab][aria-selected=true]',
} as const;

/** A press moving onto it picks; a held key passes it, picking where it stops. */
export function pickOnFocus(pick: (() => void) | undefined, restMs = REST_MS) {
  return {
    onFocus: () => {
      window.clearTimeout(resting);
      if (!pick || !usingKeys()) return;
      if (restMs && isRepeating()) resting = window.setTimeout(pick, restMs);
      else pick();
    },
    onBlur: () => window.clearTimeout(resting),
  };
}

export function tab(selected: boolean, pick: () => void, restMs = REST_MS) {
  return {
    role: 'tab',
    'aria-selected': selected,
    tabIndex: selected ? 0 : -1,
    ...pickOnFocus(selected ? undefined : pick, restMs),
  } as const;
}
