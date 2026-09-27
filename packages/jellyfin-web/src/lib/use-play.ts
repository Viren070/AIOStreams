import { playbackHost } from './hosts';
import { playOnAndroid } from './hosts/jellyfin-android';
import { ticksToMs } from './format';
import { navigate, to } from './paths';
import { externalReturnUrl } from './external-return';
import {
  directUrl,
  externalAlways,
  externalPlayerTemplate,
  externalPlayerUrl,
  subtitleUrl,
  textSubtitles,
} from './playback';
import { useSession } from './session';
import { storedMap } from './storage';
import { usePlaybackPrefs } from './user-config';
import { sameLanguage } from './languages';
import type { BaseItemDto, PlaybackInfoResponse, SourceInfo } from './types';

/** The version each item last played in, which resuming it goes straight to. */
export const lastVersions = storedMap<string>(
  'aiostreams-web-last-versions',
  500
);

/** Versions that can play; notices from addons carry text only. */
export function playableSources(
  info: PlaybackInfoResponse | undefined
): SourceInfo[] {
  return (info?.MediaSources ?? []).filter(
    (s) => s.Type !== 'Placeholder'
  ) as SourceInfo[];
}

export function noticeSources(
  info: PlaybackInfoResponse | undefined
): SourceInfo[] {
  return (info?.MediaSources ?? []).filter(
    (s) => s.Type === 'Placeholder'
  ) as SourceInfo[];
}

/** Enough to offer, few enough to keep the link short. */
const MAX_EXTERNAL_SUBTITLES = 10;

/** The returned function says whether the player was given a way to report back. */
export function usePlayExternally() {
  const { client } = useSession();
  const { prefs } = usePlaybackPrefs();
  return (item: BaseItemDto, source: SourceInfo, startMs = 0): boolean => {
    const template = externalPlayerTemplate();
    const returnUrl = template.includes('{returnUrl}')
      ? externalReturnUrl(item, source)
      : undefined;
    // A server's own file path ends in the name; a stream address does not.
    const lastSegment = source.Path?.split(/[\\/]/).pop();
    const filename =
      source.aiostreams?.filename ??
      (lastSegment && /\.\w{2,4}$/.test(lastSegment) ? lastSegment : undefined);
    const lang = prefs.SubtitleLanguagePreference;
    const subtitles = textSubtitles(source)
      .filter((s) => !lang || sameLanguage(lang, s.Language))
      .slice(0, MAX_EXTERNAL_SUBTITLES)
      .map((s) => subtitleUrl(client, s, { original: true }))
      .filter((u): u is string => !!u);
    window.location.href = externalPlayerUrl(
      template,
      directUrl(client, item.Id!, source),
      { startMs, returnUrl, filename, subtitles }
    );
    return !!returnUrl;
  };
}

/** Plays an item on whatever player this page runs in. */
export function usePlay() {
  const playExternally = usePlayExternally();
  return async (
    item: BaseItemDto,
    opts: {
      source: SourceInfo;
      startMs?: number;
      replace?: boolean;
      onExternal?: () => void;
    }
  ) => {
    const { source } = opts;
    if (!source.Id) throw new Error('No playable version was found');
    const startMs =
      opts.startMs ?? ticksToMs(item.UserData?.PlaybackPositionTicks);

    if (externalAlways() && playbackHost() !== 'android') {
      if (!playExternally(item, source, startMs)) opts.onExternal?.();
      return;
    }

    if (playbackHost() === 'android') {
      playOnAndroid(item, source, startMs);
      return;
    }
    navigate(to.play(item.Id!, source.Id, startMs), { replace: opts.replace });
  };
}
