import { currentHost } from './hosts';
import { ticksToMs } from './format';
import { navigate, to } from './paths';
import { externalReturnUrl } from './external-return';
import { chosenPlayer, playerLink } from './external-player';
import { directUrl, subtitleUrl, textSubtitles } from './playback';
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
function useOpenLink() {
  const { client } = useSession();
  const { prefs } = usePlaybackPrefs();
  return (
    template: string,
    item: BaseItemDto,
    source: SourceInfo,
    startMs: number
  ): boolean => {
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
    window.location.href = playerLink(
      template,
      directUrl(client, item.Id!, source),
      { startMs, returnUrl, filename, subtitles }
    );
    return !!returnUrl;
  };
}

/** Plays an item on the player chosen for this device. */
export function usePlay() {
  const openLink = useOpenLink();
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

    const { play } = currentHost();
    if (play) {
      play(item, source, startMs);
      return;
    }
    const player = chosenPlayer();
    if (player.kind === 'link') {
      if (!openLink(player.template, item, source, startMs))
        opts.onExternal?.();
      return;
    }
    navigate(to.play(item.Id!, source.Id, startMs), { replace: opts.replace });
  };
}
