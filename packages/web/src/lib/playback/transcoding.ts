import { t } from '@lingui/core/macro';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import type {
  MediaStream,
  PlaybackInfoResponse,
  SourceInfo,
} from '@/lib/jellyfin/types';
import { appLog } from '@/lib/hosts/shell/bridge';
import { trackLabel } from './controller';
import { deviceProfile } from './device-profile';
import type {
  EngineFactory,
  EngineFile,
  EngineTrack,
  PlayerEngine,
} from './engine';
import { chooseTracks } from './track-picks';

/** A server's conversion of a version, opened with one sound and any subtitle burned in. */
export interface Transcode {
  url: string;
  playSessionId: string | null;
  liveStreamId?: string;
  source: SourceInfo;
  /** Played, so its stop report closes the live stream. */
  played?: boolean;
}

export interface TranscodeServer {
  /** `subtitle` -1 burns in none. */
  open(
    source: SourceInfo,
    audio: number | undefined,
    subtitle: number
  ): Promise<Transcode>;
  close(transcode: Transcode): void;
}

/** The server plays its own conversion: a live channel it opens, or a file this device can't take. */
export const transcodes = (source: SourceInfo): boolean =>
  !!source.RequiresOpening ||
  (source.SupportsDirectPlay === false && !!source.TranscodingUrl);

export function transcodeServer(
  client: JellyfinClient,
  userId: string,
  itemId: string,
  maxBitrate?: number
): TranscodeServer {
  return {
    async open(source, audio, subtitle) {
      const info = await client.post<PlaybackInfoResponse>(
        `/Items/${itemId}/PlaybackInfo`,
        {
          UserId: userId,
          DeviceProfile: deviceProfile(maxBitrate),
          MediaSourceId: source.Id,
          AudioStreamIndex: audio,
          SubtitleStreamIndex: subtitle,
          ...(maxBitrate && { MaxStreamingBitrate: maxBitrate }),
          EnableDirectPlay: false,
          EnableDirectStream: false,
          AutoOpenLiveStream: true,
        },
        { userId }
      );
      const sources = info.MediaSources ?? [];
      const found = sources.find((s) => s.Id === source.Id) ?? sources[0];
      if (!found?.TranscodingUrl)
        throw new Error(info.ErrorCode ?? 'no TranscodingUrl');
      return {
        url: client.url(found.TranscodingUrl),
        playSessionId: info.PlaySessionId ?? null,
        liveStreamId: found.LiveStreamId ?? undefined,
        source: found,
      };
    },
    close(transcode) {
      void client
        .request('DELETE', '/Videos/ActiveEncodings', {
          query: {
            deviceId: client.deviceId,
            playSessionId: transcode.playSessionId,
          },
        })
        .catch(() => {});
      if (transcode.liveStreamId && !transcode.played)
        void client
          .post('/LiveStreams/Close', undefined, {
            liveStreamId: transcode.liveStreamId,
          })
          .catch(() => {});
    },
  };
}

const sounds = (source: SourceInfo) =>
  (source.MediaStreams ?? []).filter(
    (s) => s.Type === 'Audio' && !s.IsExternal
  );

const pictures = (source: SourceInfo) =>
  (source.MediaStreams ?? []).filter(
    (s) =>
      s.Type === 'Subtitle' && !s.IsExternal && s.IsTextSubtitleStream === false
  );

const idOf = (stream: MediaStream) => `server:${stream.Index}`;

function indexOf(id: string | null): number | undefined {
  const match = /^server:(\d+)$/.exec(id ?? '');
  return match ? Number(match[1]) : undefined;
}

function versionTracks(source: SourceInfo): EngineTrack[] {
  const track = (
    type: EngineTrack['type'],
    stream: MediaStream,
    n: number
  ): EngineTrack => ({
    id: idOf(stream),
    type,
    label: trackLabel(stream, n),
    lang: stream.Language ?? undefined,
    title: stream.Title ?? undefined,
    codec: stream.Codec ?? undefined,
    forced: !!stream.IsForced,
    hearingImpaired: !!stream.IsHearingImpaired,
    default: !!stream.IsDefault,
  });
  return [
    ...sounds(source).map((s, i) => track('audio', s, i + 1)),
    ...pictures(source).map((s, i) => track('subtitle', s, i + 1)),
  ];
}

/**
 * Plays the server's conversion of a version through `inner`. Its sound and a
 * picture subtitle are the server's to pick, so changing either opens another
 * conversion where this one is.
 */
export function transcodingEngine(
  inner: EngineFactory,
  server: TranscodeServer
): EngineFactory {
  return (emit, opts) => {
    let file: EngineFile | null = null;
    let current: Transcode | null = null;
    let tracks: EngineTrack[] = [];
    let audio: string | null = null;
    let burned: string | null = null;
    let positionMs = 0;
    let paused = false;
    let opened = false;
    // A text subtitle to show once the next conversion opens.
    let wanted: string | null | undefined;
    let generation = 0;

    const engine: PlayerEngine = inner((event) => {
      switch (event.type) {
        case 'tracks':
          return emit({
            type: 'tracks',
            tracks: [
              ...tracks,
              ...event.tracks.filter(
                (t) => t.type === 'subtitle' && t.external
              ),
            ],
          });
        case 'state': {
          const state = { ...event.state };
          delete state.audio;
          if ('subtitle' in state) state.subtitle = burned ?? state.subtitle;
          if (state.paused !== undefined) paused = state.paused;
          // Reports name it once it plays, as a server takes a conversion it
          // hasn't started for the file itself.
          if (state.started && current && !current.played) {
            current.played = true;
            state.stream = {
              playSessionId: current.playSessionId,
              liveStreamId: current.liveStreamId,
            };
          }
          return emit({ type: 'state', state });
        }
        case 'position':
          if (event.positionMs !== undefined) positionMs = event.positionMs;
          return emit(event);
        case 'loaded':
          if (wanted !== undefined) engine.setSubtitle(wanted);
          wanted = undefined;
          if (opened) return;
          opened = true;
          return emit(event);
        case 'unplayable':
          return emit({ type: 'failed', error: event.reason });
        default:
          return emit(event);
      }
    }, opts);

    const open = async (from: number) => {
      if (!file) return;
      const at = ++generation;
      try {
        const next = await server.open(
          file.source,
          indexOf(audio),
          indexOf(burned) ?? -1
        );
        if (at !== generation) return server.close(next);
        if (current) server.close(current);
        current = next;
        emit({ type: 'state', state: { audio, subtitle: burned } });
        engine.load({
          ...file,
          url: next.url,
          startMs: from,
          paused,
          // A conversion has no subtitles of its own to read.
          source: {
            ...next.source,
            Container: next.source.TranscodingContainer ?? 'ts',
          },
        });
      } catch (error) {
        if (at !== generation) return;
        appLog('warn', `player: no conversion: ${String(error)}`);
        emit({
          type: 'failed',
          error: t({
            comment: 'Follows "Playback failed:"',
            message: 'the server could not convert this version',
          }),
          retry: { label: t`Try again`, run: () => void open(from) },
        });
      }
    };
    const reopen = () => {
      engine.setSubtitle(null);
      void open(positionMs);
    };

    return {
      ...engine,
      load(next) {
        file = next;
        opened = false;
        wanted = undefined;
        paused = !!next.paused;
        positionMs = next.startMs;
        tracks = versionTracks(next.source);
        const first =
          sounds(next.source).find(
            (s) => s.Index === next.source.DefaultAudioStreamIndex
          ) ?? sounds(next.source)[0];
        const picks = chooseTracks(
          tracks,
          next.subtitles,
          { audio: first ? idOf(first) : null, subtitle: null },
          next.prefs,
          next.source,
          false
        );
        audio = picks.audio;
        burned = tracks.some(
          (t) => t.type === 'subtitle' && t.id === picks.subtitle
        )
          ? picks.subtitle
          : null;
        emit({ type: 'tracks', tracks });
        void open(next.startMs);
      },
      close() {
        generation++;
        engine.close();
        if (current) server.close(current);
        current = null;
      },
      setAudio(id) {
        if (id === audio || !tracks.some((t) => t.id === id)) return;
        audio = id;
        reopen();
      },
      setSubtitle(id) {
        if (id && tracks.some((t) => t.type === 'subtitle' && t.id === id)) {
          if (id === burned) return;
          burned = id;
          return reopen();
        }
        if (!burned) return engine.setSubtitle(id);
        burned = null;
        wanted = id;
        reopen();
      },
      // Pictures would come from the conversion, not the file.
      thumbnails: undefined,
      picksTracks: false,
      ownSubtitles: false,
    };
  };
}
