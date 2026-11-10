import type { FetchPastCors } from '../../hosts';
import type { SourceInfo } from '../../types';
import { assHeader, scriptFamilies } from '../ass-script';
import { assPlainText } from '../cues';
import { assLayer } from '../libass';
import { openMatroska, type MkvFile, type MkvSubtitle } from '../matroska/file';
import { pgsLayer } from '../pgs/layer';
import type { PictureSurface, SubtitleLayer } from '../surface';
import { AttachedFonts } from './fonts';
import { SubtitleHarvest, type HarvestedEvent } from './harvest';
import { rangeReader, SideReader } from './reads';

export type { HarvestedEvent } from './harvest';

/** How long the user's picks wait for the file's own tracks. */
export const EMBEDDED_WAIT_MS = 3000;

export interface EventSink {
  events(events: HarvestedEvent[]): void;
  /** The host refused the reads for good. */
  lost(error: unknown): void;
}

export interface EmbeddedSubtitles {
  /** Empty for a file that can't be read. */
  readonly subtitles: Promise<MkvSubtitle[]>;
  /** ASS with libass, PGS as pictures; null for a track the file hasn't. */
  draw(
    number: number,
    surface: PictureSurface,
    start: { delayMs: number; height: number },
    on: { onFail(error: unknown): void; onLost(error: unknown): void }
  ): SubtitleLayer | null;
  /** Text events until stopped, ASS without its styling; null for pictures or a track the file hasn't. */
  read(number: number, sink: EventSink): (() => void) | null;
  /** `bufferedMs` is null where the player doesn't say. */
  setPosition(ms: number, bufferedMs: number | null): void;
  setPlaying(playing: boolean): void;
  close(): void;
}

const SSA = /^S_(TEXT\/)?SSA$/;

export const isMatroska = (source: SourceInfo) =>
  !source.IsInfiniteStream &&
  /(^|,)\s*(mkv|matroska)\s*(,|$)/i.test(source.Container ?? '');

export function embeddedSubtitles(
  url: string,
  headers?: Record<string, string>,
  fetchFile?: FetchPastCors
): EmbeddedSubtitles {
  const reader = new SideReader(rangeReader(url, headers, fetchFile));
  reader.setPlaying(false);
  let file: MkvFile | null = null;
  let fonts: AttachedFonts | null = null;
  let closed = false;
  let positionMs = 0;
  let bufferedMs: number | null = null;
  const harvests = new Map<number, SubtitleHarvest>();
  let onPosition = (_ms: number) => {};
  let hide = () => {};

  const pool: Uint8Array[] = [];
  let onFonts = (_fonts: Uint8Array[]) => {};
  const askFonts = (script: string) => fonts?.want(scriptFamilies(script));

  const subtitles = openMatroska(reader)
    .then((opened) => {
      if (!opened || closed) return [];
      file = opened;
      fonts = new AttachedFonts(opened, (font) => {
        pool.push(font);
        onFonts([font]);
      });
      return opened.subtitles;
    })
    .catch(() => []);

  /** `again` sends the events still ahead after a seek back, for a sink that prunes what it passed. One track at a time. */
  const follow = (
    opened: MkvFile,
    track: MkvSubtitle,
    sink: EventSink,
    again = false
  ) => {
    hide();
    let harvest = harvests.get(track.number);
    if (!harvest) {
      harvest = new SubtitleHarvest(opened, track, () => reader.lanes);
      harvests.set(track.number, harvest);
    }
    const reading = harvest;
    let following = true;
    // By content, as a block dropped to save memory comes back as a new object.
    const fed = new Set<string>();
    const feed = (events: Iterable<HarvestedEvent>) => {
      const fresh = [...events].filter((event) => {
        const key = `${event.startMs}:${event.endMs}:${event.text}:${event.data?.length}`;
        if (fed.has(key)) return false;
        fed.add(key);
        return true;
      });
      if (fresh.length) sink.events(fresh);
    };
    feed(reading.events.values());
    reading.onUpdate = (event) => feed([event]);
    reading.onFail = (error, lasting) => {
      if (lasting && following) sink.lost(error);
    };
    let lastMs = positionMs;
    onPosition = (ms) => {
      if (again && ms < lastMs - 1000) {
        fed.clear();
        feed([...reading.events.values()].filter((e) => e.endMs >= ms));
      }
      lastMs = ms;
      reading.setBuffered(bufferedMs);
      reading.setPosition(ms);
    };
    reading.setBuffered(bufferedMs);
    reading.start(positionMs);
    const stop = () => {
      if (!following) return;
      following = false;
      reading.pause();
      reading.onUpdate = () => {};
      reading.onFail = () => {};
      if (hide !== stop) return;
      onPosition = () => {};
      onFonts = () => {};
      hide = () => {};
    };
    hide = stop;
    return stop;
  };

  const trackOf = (number: number) => {
    const track = file?.subtitles.find((t) => t.number === number && t.kind);
    return file && track && !closed ? { opened: file, track } : null;
  };

  return {
    subtitles,
    draw(number, surface, start, on) {
      const found = trackOf(number);
      if (found?.track.kind === 'pgs') {
        const pictures = pgsLayer(surface, start);
        const stopReading = follow(
          found.opened,
          found.track,
          {
            events: (events) =>
              pictures.addEvents(
                events.flatMap(({ startMs, endMs, data }) =>
                  data ? [{ startMs, endMs, data }] : []
                )
              ),
            lost: on.onLost,
          },
          // The layer prunes sets long past.
          true
        );
        return {
          ...pictures,
          destroy() {
            stopReading();
            pictures.destroy();
          },
        };
      }
      if (found?.track.kind !== 'ass') return null;
      const { opened, track } = found;
      const header = assHeader(track.header, SSA.test(track.codec));
      const layer = assLayer(surface, { header }, start, on.onFail);
      const stopReading = follow(
        opened,
        track,
        {
          events(events) {
            for (const event of events) askFonts(event.text);
            layer.addEvents(events);
          },
          lost: on.onLost,
        },
        // libass prunes what ended well before the playhead.
        true
      );
      layer.addFonts(pool);
      onFonts = (loaded) => layer.addFonts(loaded);
      askFonts(header);
      return {
        ...layer,
        destroy() {
          stopReading();
          layer.destroy();
        },
      };
    },
    read(number, sink) {
      const found = trackOf(number);
      if (!found || found.track.kind === 'pgs') return null;
      if (found.track.kind === 'text')
        return follow(found.opened, found.track, sink);
      // A styled line is often drawn several times, in layers and effects.
      const shown = new Set<string>();
      return follow(found.opened, found.track, {
        events(events) {
          const plain = events.flatMap((event) => {
            // ReadOrder, Layer, Style, Name, three margins and Effect come before the text.
            const text = assPlainText(event.text.split(',').slice(8).join(','));
            const key = `${event.startMs}:${event.endMs}:${text}`;
            if (!text || shown.has(key)) return [];
            shown.add(key);
            return [{ ...event, text }];
          });
          if (plain.length) sink.events(plain);
        },
        lost: sink.lost,
      });
    },
    setPosition(ms, buffered) {
      positionMs = ms;
      bufferedMs = buffered;
      onPosition(ms);
    },
    setPlaying: (playing) => reader.setPlaying(playing),
    close() {
      closed = true;
      hide();
      reader.close();
    },
  };
}
