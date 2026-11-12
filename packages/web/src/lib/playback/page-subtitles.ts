import { appLog } from '@/lib/hosts/shell/bridge';
import { parseCues, type SubtitleCue } from '@/lib/subtitles/cues';
import type { EmbeddedSubtitles } from '@/lib/subtitles/embedded';
import {
  subtitleCodec,
  type FileSubtitle,
} from '@/lib/subtitles/file-subtitle';
import { assLayer, canDrawAss } from '@/lib/subtitles/libass';
import type { PictureSurface, SubtitleLayer } from '@/lib/subtitles/surface';
import { ownTrackLabel } from './controller';
import type { EngineTrack, PlayerEngine, ServerSubtitle } from './engine';

/** Before the number of one of the file's own subtitle tracks. */
export const EMBEDDED = 'mkv:';

export const ownSubtitleTrack = (t: FileSubtitle, i: number): EngineTrack => ({
  id: `${EMBEDDED}${t.number}`,
  type: 'subtitle',
  label: ownTrackLabel(t.name, t.language, i + 1),
  lang: t.language,
  title: t.name,
  codec: subtitleCodec(t),
  forced: t.isForced,
  hearingImpaired: t.hearingImpaired,
  default: t.isDefault,
});

/** For an engine that reads the file's own subtitles itself. */
export const ownLines = (
  embedded: () => EmbeddedSubtitles | null
): Pick<PlayerEngine, 'subtitleIndex' | 'watchLines'> => ({
  async subtitleIndex() {
    const lines = await embedded()?.index();
    if (!lines?.size) return null;
    return Object.fromEntries(
      [...lines].map(([number, spans]) => [`${EMBEDDED}${number}`, spans])
    );
  },
  watchLines(id, onLines) {
    const reading = embedded();
    if (!reading || !id.startsWith(EMBEDDED)) return () => {};
    return reading.watchLines(Number(id.slice(EMBEDDED.length)), onLines);
  },
});

export const ownTrackLost = (error: unknown) =>
  appLog(
    'warn',
    `subtitles: the file's own track could not be read: ${String(error)}`
  );

export interface PickedSubtitle {
  own?: FileSubtitle;
  server?: ServerSubtitle;
  /** With a null `layer` where the file lacks the track. */
  drawn: boolean;
  layer: SubtitleLayer | null;
}

/** Draws a picture track, or a styled one while libass works; the engine shows any other pick as text. */
export function drawSubtitle(
  id: string | null,
  from: {
    own: FileSubtitle[];
    embedded: EmbeddedSubtitles | null;
    server: ServerSubtitle[];
  },
  surface: PictureSurface | null,
  start: { delayMs: number; height: number },
  on: { assFailed: boolean; onAssFail(): void; onLost?(): void }
): PickedSubtitle {
  const own = from.own.find((t) => `${EMBEDDED}${t.number}` === id);
  const server = own ? undefined : from.server.find((s) => s.id === id);
  const libass = canDrawAss() && !on.assFailed;
  const failed = (error: unknown) => {
    appLog(
      'warn',
      `subtitles: libass could not start, so they show as text: ${String(error)}`
    );
    on.onAssFail();
  };
  if (
    surface &&
    own &&
    from.embedded &&
    (own.kind === 'pgs' || (own.kind === 'ass' && libass))
  ) {
    const layer = from.embedded.draw(own.number, surface, start, {
      onFail: failed,
      onLost: (error) => {
        ownTrackLost(error);
        on.onLost?.();
      },
    });
    return { own, drawn: true, layer };
  }
  if (surface && server?.assUrl && libass) {
    const layer = assLayer(surface, { url: server.assUrl }, start, failed);
    return { server, drawn: true, layer };
  }
  return { own, server, drawn: false, layer: null };
}

/** Pushes the track's lines to `cues` as they're read, until the returned function is called. */
export function readOwnCues(
  embedded: EmbeddedSubtitles,
  number: number,
  cues: SubtitleCue[],
  on: { read(): void; lost(error: unknown): void }
): () => void {
  return (
    embedded.read(number, {
      events(events) {
        for (const { startMs, endMs, text } of events)
          cues.push({ startMs, endMs, text });
        on.read();
      },
      lost: on.lost,
    }) ?? (() => {})
  );
}

export function fetchCues(
  url: string,
  onCues: (cues: SubtitleCue[]) => void
): void {
  void fetch(url)
    .then((res) => (res.ok ? res.text() : ''))
    .then((body) => onCues(parseCues(body)))
    .catch(() => {});
}
