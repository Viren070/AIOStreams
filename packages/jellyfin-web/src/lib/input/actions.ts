import type { Host } from '../hosts';
import type { PlayerFeature } from '../player';
import { settings, useSetting } from '../settings';

export type ActionGroup = 'general' | 'navigation' | 'player' | 'sync';

export const GROUP_LABELS: Record<ActionGroup, string> = {
  general: 'General',
  navigation: 'Moving around',
  player: 'Player',
  sync: 'Sync by ear',
};

interface Action {
  label: string;
  /** A line on how it works, where the label can't say. */
  help?: string;
  group: ActionGroup;
  keys: readonly string[];
  /** Runs again while its key is held. */
  repeat?: boolean;
  /** Its keys are what it does, so they can only be turned off together. */
  fixed?: boolean;
  /** Shown in place of a long list of keys. */
  summary?: string;
  needs?: PlayerFeature;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Ids are saved with changed keys, so they never change. */
export const ACTIONS = {
  back: {
    label: 'Back',
    group: 'general',
    keys: ['Escape', 'Back', 'GamepadB'],
  },
  help: { label: 'Keyboard shortcuts', group: 'general', keys: ['?'] },

  'nav.up': {
    label: 'Up',
    group: 'navigation',
    keys: ['ArrowUp'],
    repeat: true,
  },
  'nav.down': {
    label: 'Down',
    group: 'navigation',
    keys: ['ArrowDown'],
    repeat: true,
  },
  'nav.left': {
    label: 'Left',
    group: 'navigation',
    keys: ['ArrowLeft'],
    repeat: true,
  },
  'nav.right': {
    label: 'Right',
    group: 'navigation',
    keys: ['ArrowRight'],
    repeat: true,
  },
  'nav.select': { label: 'Select', group: 'navigation', keys: ['GamepadA'] },
  'nav.menu': {
    label: 'Options',
    help: 'Opens the menu of what is selected, as a right click does.',
    group: 'navigation',
    keys: ['ContextMenu', 'GamepadY', 'Hold+Enter', 'Hold+GamepadA'],
  },
  search: {
    label: 'Search',
    group: 'navigation',
    keys: ['/', 'BrowserSearch'],
  },
  home: { label: 'Home', group: 'navigation', keys: ['H', 'BrowserHome'] },

  'player.controls': {
    label: 'Show the controls',
    group: 'player',
    keys: ['Enter', 'GamepadA'],
  },
  'player.playPause': {
    label: 'Play or pause',
    group: 'player',
    keys: ['Space', 'K', 'MediaPlayPause', 'GamepadX'],
  },
  'player.play': { label: 'Play', group: 'player', keys: ['MediaPlay'] },
  'player.pause': { label: 'Pause', group: 'player', keys: ['MediaPause'] },
  'player.stop': { label: 'Stop', group: 'player', keys: ['MediaStop'] },
  'player.skipBack': {
    label: 'Skip back',
    group: 'player',
    keys: ['ArrowLeft', 'J', 'MediaRewind', 'GamepadLB'],
    repeat: true,
  },
  'player.skipForward': {
    label: 'Skip forward',
    group: 'player',
    keys: ['ArrowRight', 'L', 'MediaFastForward', 'GamepadRB'],
    repeat: true,
  },
  'player.jump': {
    label: 'Jump through the video',
    help: '1 jumps a tenth of the way in, 5 halfway and 0 back to the start.',
    group: 'player',
    keys: DIGITS,
    fixed: true,
    summary: '0 to 9',
  },
  'player.previousChapter': {
    label: 'Previous chapter',
    group: 'player',
    needs: 'chapters',
    keys: ['PageDown'],
  },
  'player.nextChapter': {
    label: 'Next chapter',
    group: 'player',
    needs: 'chapters',
    keys: ['PageUp'],
  },
  'player.skipSegment': {
    label: 'Skip the intro or credits',
    group: 'player',
    keys: ['S'],
  },
  'player.previous': {
    label: 'Previous episode',
    group: 'player',
    keys: ['Shift+P', 'MediaTrackPrevious'],
  },
  'player.next': {
    label: 'Next episode',
    group: 'player',
    keys: ['Shift+N', 'MediaTrackNext'],
  },
  'player.volumeUp': {
    label: 'Volume up',
    group: 'player',
    keys: ['ArrowUp', 'WheelUp'],
    repeat: true,
  },
  'player.volumeDown': {
    label: 'Volume down',
    group: 'player',
    keys: ['ArrowDown', 'WheelDown'],
    repeat: true,
  },
  'player.mute': { label: 'Mute', group: 'player', keys: ['M'] },
  'player.audio': {
    label: 'Next audio track',
    group: 'player',
    keys: ['A'],
    needs: 'audio',
  },
  'player.subtitles': {
    label: 'Subtitles on or off',
    group: 'player',
    keys: ['C'],
  },
  'player.nextSubtitles': {
    label: 'Next subtitles',
    group: 'player',
    keys: ['Shift+C'],
  },
  'player.subtitlesEarlier': {
    label: 'Subtitles earlier',
    group: 'player',
    keys: ['Z'],
    repeat: true,
  },
  'player.subtitlesLater': {
    label: 'Subtitles later',
    group: 'player',
    keys: ['X'],
    repeat: true,
  },
  'player.subtitlesSmaller': {
    label: 'Smaller subtitles',
    group: 'player',
    keys: ['-'],
  },
  'player.subtitlesBigger': {
    label: 'Bigger subtitles',
    group: 'player',
    keys: ['=', 'Plus'],
  },
  'player.subtitlesLower': {
    label: 'Lower subtitles',
    group: 'player',
    keys: ['Shift+R'],
    repeat: true,
  },
  'player.subtitlesHigher': {
    label: 'Raise subtitles',
    group: 'player',
    keys: ['R'],
    repeat: true,
  },
  'player.slower': { label: 'Slower', group: 'player', keys: ['<', '['] },
  'player.faster': { label: 'Faster', group: 'player', keys: ['>', ']'] },
  'player.normalSpeed': {
    label: 'Normal speed',
    group: 'player',
    keys: ['Backspace'],
  },
  'player.fullscreen': { label: 'Full screen', group: 'player', keys: ['F'] },
  'player.stats': {
    label: 'Statistics',
    group: 'player',
    keys: ['I'],
    needs: 'stats',
  },

  'sync.heard': { label: 'Heard the line', group: 'sync', keys: ['H'] },
  'sync.saw': { label: 'Saw its subtitle', group: 'sync', keys: ['S'] },
} satisfies Record<string, Action>;

export type ActionId = keyof typeof ACTIONS;

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

export const action = (id: ActionId): Action => ACTIONS[id];

type Overrides = Record<string, string[]>;

export function keysOf(
  id: ActionId,
  overrides: Overrides = settings.shortcuts.read()
): readonly string[] {
  const { keys, fixed } = action(id);
  const override = overrides[id];
  return override && (!fixed || !override.length) ? override : keys;
}

export function useKeys(id: ActionId): readonly string[] {
  const [overrides] = useSetting(settings.shortcuts);
  return keysOf(id, overrides);
}

let index: { overrides: Overrides; byInput: Map<string, ActionId[]> } | null =
  null;

export function actionsFor(input: string): readonly ActionId[] {
  const overrides = settings.shortcuts.read();
  if (index?.overrides !== overrides) {
    const byInput = new Map<string, ActionId[]>();
    for (const id of ACTION_IDS)
      for (const key of keysOf(id, overrides))
        byInput.set(key, [...(byInput.get(key) ?? []), id]);
    index = { overrides, byInput };
  }
  return index.byInput.get(input) ?? [];
}

/** Whether it does anything here: an app's own player takes no keys, and some lack a feature. */
export function worksOn(id: ActionId, host: Host): boolean {
  const { group, needs } = action(id);
  if ((group === 'player' || group === 'sync') && host.play) return false;
  return !needs || !!host.playerFeatures?.includes(needs);
}

export const groupActions = (group: ActionGroup, host: Host) =>
  ACTION_IDS.filter((id) => action(id).group === group && worksOn(id, host));

/** The defaults clear the change. */
export function setKeys(id: ActionId, keys: string[]): void {
  const { [id]: _, ...rest } = settings.shortcuts.read();
  const defaults = action(id).keys;
  const same =
    keys.length === defaults.length && keys.every((k, i) => k === defaults[i]);
  settings.shortcuts.write(same ? rest : { ...rest, [id]: keys });
}

/** Actions of one group, or any that work everywhere, can't share an input. */
export function clashWith(id: ActionId, input: string): ActionId | undefined {
  const group = action(id).group;
  return actionsFor(input).find((other) => {
    const theirs = action(other).group;
    return (
      other !== id &&
      (theirs === group || theirs === 'general' || group === 'general')
    );
  });
}
