import { appConfig, createLogger } from '../../utils/index.js';
import {
  MediaInfoRepository,
  type MediaInfoRow,
} from '../../db/repositories/media-info.js';
import type { MediaInfoBackfillSource } from '../../config/schema/media-info.js';
import { MEDIA_INFO_VERSION, type MediaInfoRecord } from '../record.js';

const logger = createLogger('media-info');

const MAX_PENDING = 5_000;
// SQLite writes block the event loop, so a batch is kept short.
const BATCH = 50;
const FLUSH_DELAY_MS = 2_000;
const WRITTEN_LIMIT = 50_000;

/** A file a source reported; its record is built only when it is written. */
export interface Report {
  /** Every key the file is known by; they are written together. */
  releaseKeys: string[];
  file: string;
  size?: number;
  releaseFiles: number;
  title?: string;
  record(): MediaInfoRecord | undefined;
}

interface Queued extends Report {
  origin: MediaInfoBackfillSource;
  stamp: string;
}

// Sources repeat the same files all day: a file is written again only when
// what its source reports for it changes.
const written = new Map<string, string>();
const pending = new Map<string, Queued>();
const dropped = new Map<string, number>();
let timer: NodeJS.Timeout | undefined;
let flushing: Promise<void> | undefined;

export function storesFrom(source: MediaInfoBackfillSource): boolean {
  return (appConfig.mediaInfo.backfill as string[]).includes(source);
}

/** Reports waiting to be stored, and those left for later while busy. */
export function backfillUptake(): {
  pending: Record<string, number>;
  dropped: Record<string, number>;
} {
  const waiting: Record<string, number> = {};
  for (const queued of pending.values()) {
    waiting[queued.origin] = (waiting[queued.origin] ?? 0) + 1;
  }
  return { pending: waiting, dropped: Object.fromEntries(dropped) };
}

/**
 * Only cheap work runs here, on the source's own path; `describe` runs only
 * for a report worth writing, and past the queue's cap the report waits for
 * the source to report it again.
 */
export function queueReport(
  origin: MediaInfoBackfillSource,
  id: string,
  stamp: string,
  describe: () => Report | undefined
): void {
  const key = `${origin}\0${id}`;
  if (written.get(key) === stamp) return;
  if (!pending.has(key) && pending.size >= MAX_PENDING) {
    dropped.set(origin, (dropped.get(origin) ?? 0) + 1);
    return;
  }
  const report = describe();
  if (!report || report.releaseKeys.length === 0) return;
  pending.set(key, { ...report, origin, stamp });
  schedule();
}

function schedule(): void {
  if (timer || flushing || pending.size === 0) return;
  timer = setTimeout(
    () => {
      timer = undefined;
      flushing = flush().finally(() => {
        flushing = undefined;
        schedule();
      });
    },
    pending.size >= BATCH ? 0 : FLUSH_DELAY_MS
  );
  timer.unref?.();
}

function remember(key: string, stamp: string): void {
  if (written.size >= WRITTEN_LIMIT) {
    written.delete(written.keys().next().value!);
  }
  written.set(key, stamp);
}

async function flush(): Promise<void> {
  while (pending.size > 0) {
    const batch: [string, Queued][] = [];
    for (const entry of pending) {
      batch.push(entry);
      pending.delete(entry[0]);
      if (batch.length >= BATCH) break;
    }
    const rows: MediaInfoRow[] = [];
    for (const [key, report] of batch) {
      const info = report.record();
      if (!info) {
        remember(key, report.stamp);
        continue;
      }
      for (const releaseKey of report.releaseKeys) {
        rows.push({
          releaseKey,
          file: report.file,
          origin: report.origin,
          releaseFiles: report.releaseFiles,
          size: report.size || null,
          info,
          version: MEDIA_INFO_VERSION,
          title: report.title,
        });
      }
    }
    try {
      await MediaInfoRepository.upsert(rows);
      for (const [key, report] of batch) remember(key, report.stamp);
    } catch (err) {
      // Not remembered, so the source's next report offers them again.
      for (const [, report] of batch) {
        dropped.set(report.origin, (dropped.get(report.origin) ?? 0) + 1);
      }
      logger.warn(
        { err: (err as Error)?.message, files: batch.length },
        'could not store reported media info'
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}
