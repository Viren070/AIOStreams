import { t } from '@lingui/core/macro';
import { useQueryClient } from '@tanstack/react-query';
import { currentHost } from '@/lib/hosts';
import { usePlaybackInfoOptions } from '@/lib/jellyfin/playback-info';
import { fullTitle, ticksToMs } from '@/lib/format';
import { navigate, to } from '@/lib/paths';
import { externalReturnUrl } from '@/lib/playback/external-return';
import { chosenPlayer, playerLink } from '@/lib/playback/player-choice';
import { directUrl } from '@/lib/playback/stream';
import { subtitleUrl, textSubtitles } from '@/lib/subtitles/tracks';
import { useSession } from '@/lib/jellyfin/session';
import {
  subtitleLanguages,
  usePlaybackPrefs,
} from '@/lib/jellyfin/user-config';
import { useFollowing } from '@/lib/playlists';
import { sameLanguage } from '@/lib/languages';
import { party } from '@/lib/party/party';
import { usePlayForParty } from '@/lib/party/actions';
import type { BaseItemDto, SourceInfo } from '@/lib/jellyfin/types';
import { playableSources } from '@/lib/playback/sources';

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
      ? externalReturnUrl(item, source, template)
      : undefined;
    // A server's own file path ends in the name; a stream address does not.
    const lastSegment = source.Path?.split(/[\\/]/).pop();
    const filename =
      source.aiostreams?.filename ??
      (lastSegment && /\.\w{2,4}$/.test(lastSegment) ? lastSegment : undefined);
    const languages = subtitleLanguages(prefs);
    const rank = (language: string | null | undefined) =>
      languages.findIndex((l) => sameLanguage(l, language));
    const subtitles = textSubtitles(source)
      .filter((s) => !languages.length || rank(s.Language) >= 0)
      .sort((a, b) => rank(a.Language) - rank(b.Language))
      .slice(0, MAX_EXTERNAL_SUBTITLES)
      .map((s) => subtitleUrl(client, s, { original: true }))
      .filter((u): u is string => !!u);
    window.location.href = playerLink(
      template,
      directUrl(client, item.Id!, source),
      { startMs, title: fullTitle(item), returnUrl, filename, subtitles }
    );
    return !!returnUrl;
  };
}

/**
 * Plays an item on the player chosen for this device, or for the party it is
 * in, playing on through `playlist` where the player can.
 */
export function usePlay() {
  const openLink = useOpenLink();
  const following = useFollowing();
  const playForParty = usePlayForParty();
  const { prefs } = usePlaybackPrefs();
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  return async (
    item: BaseItemDto,
    opts: {
      source: SourceInfo;
      startMs?: number;
      replace?: boolean;
      playlist?: string;
      onExternal?: () => void;
    }
  ) => {
    const { source, playlist } = opts;
    if (!source.Id) throw new Error(t`No playable version was found`);
    const startMs =
      opts.startMs ?? ticksToMs(item.UserData?.PlaybackPositionTicks);
    if (party.state()?.status === 'live')
      return playForParty(item, source, startMs, playlist);

    const { play } = currentHost();
    if (play) {
      const next =
        prefs.EnableNextEpisodeAutoPlay !== false
          ? await following(item, playlist).catch(() => [])
          : [];
      play(
        item,
        source,
        startMs,
        next.map((e) => e.Id!)
      );
      return;
    }
    const player = chosenPlayer();
    if (player.kind === 'link') {
      const info = await queryClient
        .fetchQuery(infoOptions(item.Id!, source.Id))
        .catch(() => undefined);
      const named = playableSources(info).find((s) => s.Id === source.Id);
      if (!openLink(player.template, item, named ?? source, startMs))
        opts.onExternal?.();
      return;
    }
    navigate(to.play(item.Id!, source.Id, startMs, playlist), {
      replace: opts.replace,
    });
  };
}
