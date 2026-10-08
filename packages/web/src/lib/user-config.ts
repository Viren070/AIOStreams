import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from './session';
import type { UserDto } from './types';

export type SubtitleMode =
  | 'Default'
  | 'Always'
  | 'OnlyForced'
  | 'None'
  | 'Smart';

export const ORIGINAL_LANGUAGE = 'OriginalLanguage';

/** The playback preferences in Jellyfin's user configuration. */
export interface PlaybackPrefs {
  /** A language code, or `OriginalLanguage`; the first of `AudioLanguages`. */
  AudioLanguagePreference?: string | null;
  /** Tried in order, a list this server keeps beside Jellyfin's one language. */
  AudioLanguages?: string[];
  PlayDefaultAudioTrack?: boolean;
  SubtitleLanguagePreference?: string | null;
  SubtitleLanguages?: string[];
  SubtitleMode?: SubtitleMode;
  EnableNextEpisodeAutoPlay?: boolean;
  /** Off only when false, as in Jellyfin. */
  RememberAudioSelections?: boolean;
  RememberSubtitleSelections?: boolean;
}

// A server without the lists has only the single language.
const languages = (
  list: string[] | undefined,
  one: string | null | undefined
) => (list?.length ? list : one ? [one] : []);

export const audioLanguages = (prefs: PlaybackPrefs) =>
  languages(prefs.AudioLanguages, prefs.AudioLanguagePreference);

export const subtitleLanguages = (prefs: PlaybackPrefs) =>
  languages(prefs.SubtitleLanguages, prefs.SubtitleLanguagePreference);

type Configuration = NonNullable<UserDto['Configuration']>;

function useConfigurationKey() {
  const { client, user } = useSession();
  return ['jf', client.base, user.Id, 'configuration'] as const;
}

/** Saved on the server, so they follow the user to other devices and apps. */
export function usePlaybackPrefs() {
  const { client, user } = useSession();
  const queryClient = useQueryClient();
  const queryKey = useConfigurationKey();
  const query = useQuery({
    queryKey,
    meta: { cache: 'account' },
    queryFn: async () =>
      (await client.get<UserDto>('/Users/Me')).Configuration ?? {},
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: (next: Configuration) =>
      client.post('/Users/Configuration', next, { userId: user.Id }),
    onMutate: (next) => queryClient.setQueryData(queryKey, next),
    onError: () => {
      toast.error('Could not save that setting');
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const prefs = (query.data ?? {}) as PlaybackPrefs;
  return {
    prefs,
    isLoading: query.isLoading,
    update: (patch: PlaybackPrefs) =>
      save.mutate({ ...(query.data ?? {}), ...patch } as Configuration),
  };
}
