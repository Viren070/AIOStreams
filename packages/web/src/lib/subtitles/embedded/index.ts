import { readAll, type ByteReader } from '@/lib/byte-reader';
import type { FetchPastCors } from '@/lib/hosts';
import type { SourceInfo } from '@/lib/jellyfin/types';
import type { Span } from '@/lib/subtitles/align';
import { assHeader, scriptFamilies } from '@/lib/subtitles/ass-script';
import { assPlainText } from '@/lib/subtitles/cues';
import type { FileSubtitle } from '@/lib/subtitles/file-subtitle';
import { assLayer } from '@/lib/subtitles/libass';
import {
  openMatroska,
  type MkvFile,
  type MkvSubtitle,
} from '@/lib/subtitles/matroska/file';
import { indexLines } from '@/lib/subtitles/matroska/lines';
import { openMp4, sampleLines } from '@/lib/subtitles/mp4/file';
import { pgsLayer } from '@/lib/subtitles/pgs/layer';
import type { PictureSurface, SubtitleLayer } from '@/lib/subtitles/surface';
import { AttachedFonts } from './fonts';
import type {
  HarvestedEvent,
  ReadPace,
  SubtitleHarvest,
  SuppliedBlock,
} from './harvest';
import { MatroskaHarvest } from './harvest/matroska';
import { Mp4Harvest } from './harvest/mp4';
import { rangeReader, SideReader } from './reads';

export type { HarvestedEvent, SuppliedBlock } from './harvest';

/** How long the user's picks wait for the file's own tracks. */
const EMBEDDED_WAIT_MS = 3000;

export interface EventSink {
  events(events: HarvestedEvent[]): void;
  /** The host refused the reads for good. */
  lost(error: unknown): void;
}

export interface EmbeddedSubtitles {
  /** The tracks the page can show; empty for a file that can't be read. */
  readonly subtitles: Promise<FileSubtitle[]>;
  /** Once `subtitles` is in, or after a wait for it. */
  listed(): Promise<void>;
  /** When each track's lines show, from the file's index, by track number; tracks the index leaves out are missing. */
  index(): Promise<Map<number, Span[]>>;
  /** When a track's lines show, from the index and then as they're read, until stopped. */
  watchLines(number: number, onLines: (lines: Span[]) => void): () => void;
  /** ASS with libass, PGS as pictures; null for a track the file hasn't. */
  draw(
    number: number,
    surface: PictureSurface,
    start: { delayMs: number; height: number },
    on: { onFail(error: unknown): void; onLost(error: unknown): void }
  ): SubtitleLayer | null;
  /** Text events until stopped, ASS without its styling; null for pictures or a track the file hasn't. */
  read(number: number, sink: EventSink): (() => void) | null;
  /** A Matroska file's subtitle blocks the player read with the video; from the first, no track is read for them. */
  supply(blocks: readonly SuppliedBlock[]): void;
  /** `bufferedMs` is null where the player doesn't say. */
  setPosition(ms: number, bufferedMs: number | null): void;
  setPlaying(playing: boolean): void;
  close(): void;
}

const SSA = /^S_(TEXT\/)?SSA$/;
const EARLY_BLOCKS = 20_000;
const HEAD_BYTES = 256 * 1024;

export const readsOwnSubtitles = (source: SourceInfo) =>
  !source.IsInfiniteStream &&
  /(^|,)\s*(mkv|matroska|webm|mp4|m4v|mov)\s*(,|$)/i.test(
    source.Container ?? ''
  );

interface OpenedFile {
  subtitles: FileSubtitle[];
  /** With the attachments and ASS headers only Matroska has. */
  matroska?: MkvFile;
  harvest(track: FileSubtitle, pace: ReadPace): SubtitleHarvest;
  lines(track: FileSubtitle): Span[];
}

async function openFile(reader: ByteReader): Promise<OpenedFile | null> {
  const start = await readAll(reader, 0, HEAD_BYTES);
  const matroska = await openMatroska(reader, start);
  if (matroska)
    return {
      subtitles: matroska.subtitles,
      matroska,
      harvest: (track, pace) =>
        new MatroskaHarvest(matroska, track as MkvSubtitle, pace),
      lines: (track) => indexLines(matroska, track as MkvSubtitle),
    };
  const mp4 = await openMp4(reader, start);
  return (
    mp4 && {
      subtitles: mp4.subtitles,
      harvest: (track, pace) => new Mp4Harvest(mp4, track, pace),
      lines: (track) => sampleLines(mp4, track.number),
    }
  );
}

export function embeddedSubtitles(
  url: string,
  headers?: Record<string, string>,
  fetchFile?: FetchPastCors
): EmbeddedSubtitles {
  const reader = new SideReader(rangeReader(url, headers, fetchFile));
  reader.setPlaying(false);
  let file: OpenedFile | null = null;
  let fonts: AttachedFonts | null = null;
  let closed = false;
  let positionMs = 0;
  let bufferedMs: number | null = null;
  const harvests = new Map<number, SubtitleHarvest>();
  let supplied = false;
  /** Blocks that came before the file's head was read. */
  let early: SuppliedBlock[] = [];
  let onPosition = (_ms: number) => {};
  let hide = () => {};

  const pool: Uint8Array[] = [];
  let onFonts = (_fonts: Uint8Array[]) => {};
  const askFonts = (script: string) => fonts?.want(scriptFamilies(script));

  const subtitles = openFile(reader)
    .then((opened) => {
      if (!opened || closed) return [];
      file = opened;
      const waiting = early;
      early = [];
      if (waiting.length) supply(waiting);
      if (opened.matroska)
        fonts = new AttachedFonts(opened.matroska, (font) => {
          pool.push(font);
          onFonts([font]);
        });
      return opened.subtitles.filter((track) => track.kind);
    })
    .catch(() => []);

  /** `again` sends the events still ahead after a seek back, for a sink that prunes what it passed. One track at a time. */
  const follow = (
    opened: OpenedFile,
    track: FileSubtitle,
    sink: EventSink,
    again = false
  ) => {
    hide();
    let harvest = harvests.get(track.number);
    if (!harvest) {
      harvest = opened.harvest(track, reader);
      if (supplied) harvest.fromPlayer();
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

  const supply = (blocks: readonly SuppliedBlock[]) => {
    if (closed) return;
    const opened = file;
    if (!opened) {
      early = [...early, ...blocks].slice(-EARLY_BLOCKS);
      return;
    }
    if (!opened.matroska) return;
    if (!supplied) {
      supplied = true;
      for (const harvest of harvests.values()) harvest.fromPlayer();
    }
    for (const block of blocks) {
      const track = opened.subtitles.find(
        (t) => t.number === block.trackNumber && t.kind
      );
      if (!track) continue;
      let harvest = harvests.get(track.number);
      if (!harvest) {
        harvest = opened.harvest(track, reader);
        harvest.fromPlayer();
        harvests.set(track.number, harvest);
      }
      void harvest.supplyBlock(block);
    }
  };

  const read = (number: number, sink: EventSink) => {
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
  };

  return {
    subtitles,
    listed: () =>
      Promise.race([
        subtitles.then(() => {}),
        new Promise<void>((done) => setTimeout(done, EMBEDDED_WAIT_MS)),
      ]),
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
      const header = assHeader(
        (track as MkvSubtitle).header,
        SSA.test(track.codec)
      );
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
    read,
    supply,
    index: () =>
      subtitles.then(() => {
        const opened = file;
        const lines = new Map<number, Span[]>();
        if (!opened || closed) return lines;
        for (const track of opened.subtitles) {
          const found = opened.lines(track);
          if (found.length) lines.set(track.number, found);
        }
        return lines;
      }),
    watchLines(number, onLines) {
      let stopped = false;
      let stopReading = () => {};
      void subtitles.then(() => {
        const found = trackOf(number);
        if (stopped || !found) return;
        const indexed = found.opened.lines(found.track);
        if (indexed.length) onLines(indexed);
        // Pictures' lines come from the index alone.
        if (found.track.kind === 'pgs') return;
        stopReading =
          read(number, {
            events: (events) =>
              onLines(events.map(({ startMs, endMs }) => ({ startMs, endMs }))),
            lost: () => {},
          }) ?? (() => {});
      });
      return () => {
        stopped = true;
        stopReading();
      };
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
