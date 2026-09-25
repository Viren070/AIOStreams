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

/** The playback preferences in Jellyfin's user configuration. */
export interface PlaybackPrefs {
  AudioLanguagePreference?: string | null;
  SubtitleLanguagePreference?: string | null;
  SubtitleMode?: SubtitleMode;
  EnableNextEpisodeAutoPlay?: boolean;
}

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
