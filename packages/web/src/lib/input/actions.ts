import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import type { Host } from '../hosts';
import { browserFeatures, type PlayerFeature } from '../playback/controller';
import { settings, useSetting } from '../settings';

export type ActionGroup = 'general' | 'navigation' | 'player' | 'sync';

export const groupLabel = (group: ActionGroup) =>
  ({
    general: t`General`,
    navigation: t`Moving around`,
    player: t`Player`,
    sync: t`Sync by ear`,
  })[group];

interface Action {
  label: MessageDescriptor;
  /** A line on how it works, where the label can't say. */
  help?: MessageDescriptor;
  group: ActionGroup;
  keys: readonly string[];
  /** Runs again while its key is held. */
  repeat?: boolean;
  /** Its keys are what it does, so they can only be turned off together. */
  fixed?: boolean;
  /** Shown in place of a long list of keys. */
  summary?: MessageDescriptor;
  needs?: PlayerFeature;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Ids are saved with changed keys, so they never change. */
export const ACTIONS = {
  back: {
    label: msg`Back`,
    group: 'general',
    keys: ['Escape', 'Back', 'GamepadB'],
  },
  help: { label: msg`Keyboard shortcuts`, group: 'general', keys: ['?'] },

  'nav.up': {
    label: msg`Up`,
    group: 'navigation',
    keys: ['ArrowUp'],
    repeat: true,
  },
  'nav.down': {
    label: msg`Down`,
    group: 'navigation',
    keys: ['ArrowDown'],
    repeat: true,
  },
  'nav.left': {
    label: msg`Left`,
    group: 'navigation',
    keys: ['ArrowLeft'],
    repeat: true,
  },
  'nav.right': {
    label: msg`Right`,
    group: 'navigation',
    keys: ['ArrowRight'],
    repeat: true,
  },
  'nav.select': { label: msg`Select`, group: 'navigation', keys: ['GamepadA'] },
  'nav.menu': {
    label: msg`Options`,
    help: msg`Opens the menu of what is selected, as a right click does.`,
    group: 'navigation',
    keys: ['ContextMenu', 'GamepadY', 'Hold+Enter', 'Hold+GamepadA'],
  },
  search: {
    label: msg`Search`,
    group: 'navigation',
    keys: ['/', 'BrowserSearch'],
  },
  home: { label: msg`Home`, group: 'navigation', keys: ['H', 'BrowserHome'] },

  'player.controls': {
    label: msg`Show the controls`,
    group: 'player',
    keys: ['Enter', 'GamepadA'],
  },
  'player.playPause': {
    label: msg`Play or pause`,
    group: 'player',
    keys: ['Space', 'K', 'MediaPlayPause', 'GamepadX'],
  },
  'player.play': { label: msg`Play`, group: 'player', keys: ['MediaPlay'] },
  'player.pause': { label: msg`Pause`, group: 'player', keys: ['MediaPause'] },
  'player.stop': { label: msg`Stop`, group: 'player', keys: ['MediaStop'] },
  'player.skipBack': {
    label: msg`Skip back`,
    group: 'player',
    keys: ['ArrowLeft', 'J', 'MediaRewind', 'GamepadLB'],
    repeat: true,
  },
  'player.skipForward': {
    label: msg`Skip forward`,
    group: 'player',
    keys: ['ArrowRight', 'L', 'MediaFastForward', 'GamepadRB'],
    repeat: true,
  },
  'player.jump': {
    label: msg`Jump through the video`,
    help: msg`1 jumps a tenth of the way in, 5 halfway and 0 back to the start.`,
    group: 'player',
    keys: DIGITS,
    fixed: true,
    summary: msg`0 to 9`,
  },
  'player.previousChapter': {
    label: msg`Previous chapter`,
    group: 'player',
    needs: 'chapters',
    keys: ['PageDown'],
  },
  'player.nextChapter': {
    label: msg`Next chapter`,
    group: 'player',
    needs: 'chapters',
    keys: ['PageUp'],
  },
  'player.skipSegment': {
    label: msg`Skip the intro or credits`,
    group: 'player',
    keys: ['S'],
  },
  'player.previous': {
    label: msg`Previous episode`,
    group: 'player',
    keys: ['Shift+P', 'MediaTrackPrevious'],
  },
  'player.next': {
    label: msg`Next episode`,
    group: 'player',
    keys: ['Shift+N', 'MediaTrackNext'],
  },
  'player.volumeUp': {
    label: msg`Volume up`,
    group: 'player',
    keys: ['ArrowUp', 'WheelUp'],
    repeat: true,
  },
  'player.volumeDown': {
    label: msg`Volume down`,
    group: 'player',
    keys: ['ArrowDown', 'WheelDown'],
    repeat: true,
  },
  'player.mute': { label: msg`Mute`, group: 'player', keys: ['M'] },
  'player.audio': {
    label: msg`Next audio track`,
    group: 'player',
    keys: ['A'],
    needs: 'audio',
  },
  'player.subtitles': {
    label: msg`Subtitles on or off`,
    group: 'player',
    keys: ['C'],
  },
  'player.nextSubtitles': {
    label: msg`Next subtitles`,
    group: 'player',
    keys: ['Shift+C'],
  },
  'player.subtitlesEarlier': {
    label: msg`Subtitles earlier`,
    group: 'player',
    keys: ['Z'],
    repeat: true,
  },
  'player.subtitlesLater': {
    label: msg`Subtitles later`,
    group: 'player',
    keys: ['X'],
    repeat: true,
  },
  'player.subtitlesSmaller': {
    label: msg`Smaller subtitles`,
    group: 'player',
    keys: ['-'],
  },
  'player.subtitlesBigger': {
    label: msg`Bigger subtitles`,
    group: 'player',
    keys: ['=', 'Plus'],
  },
  'player.subtitlesLower': {
    label: msg`Lower subtitles`,
    group: 'player',
    keys: ['Shift+R'],
    repeat: true,
  },
  'player.subtitlesHigher': {
    label: msg`Raise subtitles`,
    group: 'player',
    keys: ['R'],
    repeat: true,
  },
  'player.slower': { label: msg`Slower`, group: 'player', keys: ['<', '['] },
  'player.faster': { label: msg`Faster`, group: 'player', keys: ['>', ']'] },
  'player.normalSpeed': {
    label: msg`Normal speed`,
    group: 'player',
    keys: ['Backspace'],
  },
  'player.speedUp': {
    label: msg`Speed up while held`,
    help: msg`Plays faster for as long as the key is held, at the speed set in Playback settings.`,
    group: 'player',
    keys: ['Hold+Space', 'Hold+Enter', 'Hold+GamepadX'],
  },
  'player.fullscreen': {
    label: msg`Full screen`,
    group: 'player',
    keys: ['F'],
  },
  'player.stats': {
    label: msg`Statistics`,
    group: 'player',
    keys: ['I'],
    needs: 'stats',
  },

  'sync.heard': { label: msg`Heard the line`, group: 'sync', keys: ['H'] },
  'sync.saw': { label: msg`Saw its subtitle`, group: 'sync', keys: ['S'] },
} satisfies Record<string, Action>;

export type ActionId = keyof typeof ACTIONS;

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

export const action = (id: ActionId): Action => ACTIONS[id];

/** What a list of shortcuts shows for one, in the app's language. */
export function actionText(id: ActionId) {
  const { label, help, summary } = action(id);
  return {
    label: i18n._(label),
    help: help && i18n._(help),
    summary: summary && i18n._(summary),
  };
}

type Overrides = Record<string, string[]>;

export function keysOf(
  id: ActionId,
  overrides: Overrides = settings.controls.shortcuts.read()
): readonly string[] {
  const { keys, fixed } = action(id);
  const override = overrides[id];
  return override && (!fixed || !override.length) ? override : keys;
}

export function useKeys(id: ActionId): readonly string[] {
  const [overrides] = useSetting(settings.controls.shortcuts);
  return keysOf(id, overrides);
}

let index: { overrides: Overrides; byInput: Map<string, ActionId[]> } | null =
  null;

export function actionsFor(input: string): readonly ActionId[] {
  const overrides = settings.controls.shortcuts.read();
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
  const features = host.player ? host.playerFeatures : browserFeatures;
  return !needs || !!features?.includes(needs);
}

export const groupActions = (group: ActionGroup, host: Host) =>
  ACTION_IDS.filter((id) => action(id).group === group && worksOn(id, host));

/** The defaults clear the change. */
export function setKeys(id: ActionId, keys: string[]): void {
  const { [id]: _, ...rest } = settings.controls.shortcuts.read();
  const defaults = action(id).keys;
  const same =
    keys.length === defaults.length && keys.every((k, i) => k === defaults[i]);
  settings.controls.shortcuts.write(same ? rest : { ...rest, [id]: keys });
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
