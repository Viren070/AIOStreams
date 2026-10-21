import { usingKeys } from './dispatch';

/** Long enough for a held arrow to pass a tab without picking it. */
const REST_MS = 250;

let resting = 0;

/** A row of tabs, entered at the one picked. */
export const tabList = {
  role: 'tablist',
  'data-nav-enter': '[role=tab][aria-selected=true]',
} as const;

/** A remote or keyboard moving onto it picks it once focus rests there; a click picks it as before. */
export function tab(selected: boolean, pick: () => void, restMs = REST_MS) {
  return {
    role: 'tab',
    'aria-selected': selected,
    tabIndex: selected ? 0 : -1,
    onFocus: () => {
      window.clearTimeout(resting);
      if (selected || !usingKeys()) return;
      if (restMs) resting = window.setTimeout(pick, restMs);
      else pick();
    },
    onBlur: () => window.clearTimeout(resting),
  } as const;
}
