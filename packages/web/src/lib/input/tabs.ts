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

/** A press moving onto it picks it; a held key passes it, picking the tab it stops on. */
export function tab(selected: boolean, pick: () => void, restMs = REST_MS) {
  return {
    role: 'tab',
    'aria-selected': selected,
    tabIndex: selected ? 0 : -1,
    onFocus: () => {
      window.clearTimeout(resting);
      if (selected || !usingKeys()) return;
      if (restMs && isRepeating()) resting = window.setTimeout(pick, restMs);
      else pick();
    },
    onBlur: () => window.clearTimeout(resting),
  } as const;
}
