import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../session';
import { languageCode, sameLanguage } from '../languages';
import { ORIGINAL_LANGUAGE, usePlaybackPrefs } from '../user-config';
import type { PlaybackPrefs } from '../user-config';
import type { PlayerController, Track } from './controller';
import type { BaseItemDto, SourceInfo } from '../types';

/** The user's display preferences under this id hold a pick per show. */
const PREFS_ID = 'aiostreams-web-tracks';
/** `audio|subtitle`: a language code each, `off` for no subtitles, or empty. */
type Picks = Record<string, string>;
const OFF = 'off';

interface ShowPick {
  audio?: string;
  subtitle?: string;
}

const showOf = (item: BaseItemDto) =>
  item.Type === 'Episode' ? (item.SeriesId ?? undefined) : undefined;

function pickOf(picks: Picks | undefined, showId: string): ShowPick {
  const [audio, subtitle] = (picks?.[showId] ?? '').split('|');
  return { audio: audio || undefined, subtitle: subtitle || undefined };
}

function langOf(track: Track | undefined): string | undefined {
  const lang = track?.lang;
  return lang && !/^(und|mul|zxx|mis)$/i.test(lang)
    ? languageCode(lang)
    : undefined;
}

function usePicksKey() {
  const { client, user } = useSession();
  return ['jf', client.base, user.Id, 'show-tracks'] as const;
}

export function useShowPicks() {
  const { client, user } = useSession();
  return useQuery({
    queryKey: usePicksKey(),
    queryFn: async () => {
      const prefs = await client.get<{
        CustomPrefs?: Record<string, string | null>;
      }>(`/DisplayPreferences/${PREFS_ID}`, {
        client: PREFS_ID,
        userId: user.Id,
      });
      // Servers add defaults of their own; a pick always has a `|`.
      return Object.fromEntries(
        Object.entries(prefs.CustomPrefs ?? {}).filter(
          (entry): entry is [string, string] => !!entry[1]?.includes('|')
        )
      ) as Picks;
    },
    staleTime: 5 * 60_000,
  });
}

/** The user's languages, with the ones they picked for this show in their place. */
export function withShowPick(
  prefs: PlaybackPrefs,
  picks: Picks | undefined,
  item: BaseItemDto
): PlaybackPrefs {
  const showId = showOf(item);
  if (!showId) return prefs;
  const { audio, subtitle } = pickOf(picks, showId);
  const out = { ...prefs };
  if (audio && prefs.RememberAudioSelections !== false) {
    out.AudioLanguagePreference = audio;
    out.PlayDefaultAudioTrack = false;
  }
  if (subtitle && prefs.RememberSubtitleSelections !== false) {
    if (subtitle === OFF) out.SubtitleMode = 'None';
    else {
      out.SubtitleLanguagePreference = subtitle;
      out.SubtitleMode = 'Always';
    }
  }
  return out;
}

/** The audio language the user's settings pick. */
function settingsAudio(prefs: PlaybackPrefs, source: SourceInfo) {
  const lang =
    prefs.AudioLanguagePreference === ORIGINAL_LANGUAGE
      ? source.MediaStreams?.find(
          (s) =>
            s.Type === 'Audio' && s.Index === source.DefaultAudioStreamIndex
        )?.Language
      : prefs.AudioLanguagePreference;
  return lang ? languageCode(lang) : undefined;
}

function useSavePick() {
  const { client, user } = useSession();
  const queryClient = useQueryClient();
  const queryKey = usePicksKey();
  return (showId: string, change: ShowPick) => {
    const picks = queryClient.getQueryData<Picks>(queryKey) ?? {};
    const pick = { ...pickOf(picks, showId), ...change };
    const entry =
      pick.audio || pick.subtitle
        ? `${pick.audio ?? ''}|${pick.subtitle ?? ''}`
        : '';
    if (entry === (picks[showId] ?? '')) return;
    const { [showId]: _, ...rest } = picks;
    const next = entry ? { ...rest, [showId]: entry } : rest;
    queryClient.setQueryData(queryKey, next);
    // A server may keep a key it is not sent, so a forgotten pick is sent empty.
    void client
      .post(
        `/DisplayPreferences/${PREFS_ID}`,
        {
          Id: PREFS_ID,
          Client: PREFS_ID,
          CustomPrefs: { ...next, ...(entry ? {} : { [showId]: '' }) },
        },
        { client: PREFS_ID, userId: user.Id }
      )
      .catch(() => undefined);
  };
}

/**
 * The player, keeping the tracks the user picks as the show's. A pick of what
 * the user's settings would play forgets it.
 */
export function useShowTrackPicks(
  player: PlayerController,
  item: BaseItemDto,
  source: SourceInfo
): PlayerController {
  const { prefs } = usePlaybackPrefs();
  const save = useSavePick();
  const showId = showOf(item);
  if (!showId) return player;
  return {
    ...player,
    setAudio: (id) => {
      player.setAudio(id);
      const lang = langOf(player.audioTracks.find((t) => t.id === id));
      if (!lang || prefs.RememberAudioSelections === false) return;
      save(showId, {
        audio: lang === settingsAudio(prefs, source) ? undefined : lang,
      });
    },
    setSubtitle: (id) => {
      player.setSubtitle(id);
      if (prefs.RememberSubtitleSelections === false) return;
      if (id === null) {
        save(showId, {
          subtitle: prefs.SubtitleMode === 'None' ? undefined : OFF,
        });
        return;
      }
      const lang = langOf(player.subtitleTracks.find((t) => t.id === id));
      if (!lang) return;
      const usual =
        prefs.SubtitleMode === 'Always' &&
        sameLanguage(prefs.SubtitleLanguagePreference, lang);
      save(showId, { subtitle: usual ? undefined : lang });
    },
  };
}
