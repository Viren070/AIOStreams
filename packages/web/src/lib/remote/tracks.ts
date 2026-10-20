import { sameLanguage } from '../languages';
import type { Track } from '../playback/controller';
import type { MediaStream } from '../types';

export type TrackKind = 'audio' | 'subtitle';

/** The version's own streams of a kind, in file order, beside the player's. */
function ownOf(streams: MediaStream[], tracks: Track[], kind: TrackKind) {
  const audio = kind === 'audio';
  return {
    streams: streams.filter(
      (s) =>
        (audio ? s.Type === 'Audio' : s.Type === 'Subtitle') && !s.IsExternal
    ),
    tracks: kind === 'audio' ? tracks : tracks.filter((t) => t.file),
  };
}

/**
 * The player's track for a server's stream index: null turns subtitles off,
 * undefined finds none. A file's own track goes by its place among them when
 * both lists count the same, else by language.
 */
export function trackForIndex(
  streams: MediaStream[],
  tracks: Track[],
  kind: TrackKind,
  index: number
): string | null | undefined {
  if (kind === 'subtitle' && index < 0) return null;
  const server = tracks.find((t) => t.id === `server:${index}`);
  if (server) return server.id;
  const own = ownOf(streams, tracks, kind);
  const at = own.streams.findIndex((s) => s.Index === index);
  if (at < 0) return undefined;
  if (own.streams.length === own.tracks.length) return own.tracks[at].id;
  const lang = own.streams[at].Language;
  return lang
    ? own.tracks.find((t) => sameLanguage(lang, t.lang))?.id
    : undefined;
}

export function indexForTrack(
  streams: MediaStream[],
  tracks: Track[],
  kind: TrackKind,
  id: string | null
): number | undefined {
  if (id === null) return kind === 'subtitle' ? -1 : undefined;
  const server = /^server:(-?\d+)$/.exec(id);
  if (server) return Number(server[1]);
  const own = ownOf(streams, tracks, kind);
  const at = own.tracks.findIndex((t) => t.id === id);
  if (at < 0) return undefined;
  if (own.streams.length === own.tracks.length)
    return own.streams[at].Index ?? undefined;
  const lang = own.tracks[at].lang;
  return lang
    ? (own.streams.find((s) => sameLanguage(lang, s.Language))?.Index ??
        undefined)
    : undefined;
}
