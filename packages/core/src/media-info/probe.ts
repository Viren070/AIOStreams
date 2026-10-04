import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appConfig, createLogger } from '../utils/index.js';
import {
  LOCAL_ORIGIN,
  MediaInfoRepository,
} from '../db/repositories/media-info.js';
import {
  MediaInfoProbeRepository,
  type ProbeKind,
  type ProbeOutcome,
  type ProbePath,
  type ProbeReader,
} from '../db/repositories/media-info-probes.js';
import { FfprobeMissingError, probeMediaInfo } from './ffprobe.js';
import { withLoopbackUrl, type FileReader } from './loopback.js';
import { MEDIA_INFO_VERSION, type MediaInfoRecord } from './record.js';

const logger = createLogger('media-info');

const DEBOUNCE_MS = 5 * 60_000;

export interface OpenedFile extends FileReader {
  name?: string;
}

export interface ProbeTarget {
  /**
   * Every key the release is known by, best first. With none, the result is
   * only handed to whoever waits on it.
   */
  releaseKeys: string[];
  /** The file inside the release, when known before reading. */
  file?: string;
  releaseFiles: number;
  title?: string;
  path: ProbePath;
  kind: ProbeKind;
  reader: ProbeReader;
  /** Dedupes the probe when its release key or file is not known yet. */
  dedupeKey?: string;
  delayMs?: number;
  open(signal: AbortSignal): Promise<OpenedFile>;
  onStored?(record: MediaInfoRecord, file: string): Promise<void>;
}

export type ProbeStage = 'waiting' | 'queued' | 'opening' | 'probing';

export interface ProbeJob {
  id: string;
  releaseKey: string;
  file: string;
  path: ProbePath;
  kind: ProbeKind;
  reader: ProbeReader;
  stage: ProbeStage;
  queuedAt: number;
  startedAt?: number;
  bytesRead: number;
}

export interface ProberSnapshot {
  enabled: boolean;
  jobs: ProbeJob[];
  limits: { concurrency: number; queue: number; timeoutSeconds: number };
  ffprobe: { path: string; missing: boolean };
}

/** A file from its claim until its probe ends or is skipped. */
interface Pending {
  settled: Promise<MediaInfoRecord | undefined>;
  settle(record?: MediaInfoRecord): void;
  /** Someone is waiting on it, so it goes ahead of the queue. */
  urgent: boolean;
}

interface Job {
  id: string;
  releaseKey?: string;
  file?: string;
  stage: ProbeStage;
  queuedAt: number;
  startedAt?: number;
  bytesRead: number;
  dedupeKey: string;
  target: ProbeTarget;
  timer?: NodeJS.Timeout;
  abort?: AbortController;
  ending?: 'timeout' | 'cancelled';
}

const STAGE_ORDER: Record<ProbeStage, number> = {
  probing: 0,
  opening: 0,
  queued: 1,
  waiting: 2,
};

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function probeKey(releaseKey: string, file: string): string {
  return `${releaseKey}:${file}`;
}

export interface ProbeFinished {
  releaseKeys: string[];
  outcome: ProbeOutcome;
}

/** Emits `finished` with a {@link ProbeFinished} once an attempt is logged. */
class MediaInfoProber extends EventEmitter {
  private readonly jobs = new Map<string, Job>();
  private readonly live = new Map<string, Pending>();
  private readonly recent = new Map<string, number>();
  private missingPath: string | undefined;

  private get missing(): boolean {
    return appConfig.mediaInfo.ffprobePath === this.missingPath;
  }

  /**
   * Queues a probe and returns the key to {@link waitFor} it by. Returns
   * nothing when it was skipped, including a recent attempt at the same file.
   */
  queue(target: ProbeTarget): string | undefined {
    if (!appConfig.mediaInfo.probe || this.missing) return undefined;
    const [releaseKey] = target.releaseKeys;
    const dedupeKey =
      releaseKey && target.file
        ? probeKey(releaseKey, target.file)
        : target.dedupeKey;
    if (!dedupeKey) return undefined;
    if (this.live.has(dedupeKey)) return dedupeKey;
    if (!this.claim(dedupeKey)) return undefined;
    let settle!: (record?: MediaInfoRecord) => void;
    const settled = new Promise<MediaInfoRecord | undefined>(
      (resolve) => (settle = resolve)
    );
    this.live.set(dedupeKey, { settled, settle, urgent: false });
    const current =
      releaseKey && target.file
        ? MediaInfoRepository.hasCurrent(releaseKey, target.file)
        : Promise.resolve(false);
    current
      .then((done) => {
        if (done) return this.settle(dedupeKey);
        if (this.jobs.size >= appConfig.mediaInfo.maxQueuedProbes) {
          logger.debug({ file: target.file }, 'probe queue full, skipped');
          return this.settle(dedupeKey);
        }
        const job: Job = {
          id: randomUUID(),
          releaseKey,
          file: target.file,
          stage: 'waiting',
          queuedAt: Date.now(),
          bytesRead: 0,
          dedupeKey,
          target,
        };
        this.jobs.set(job.id, job);
        if (!target.delayMs || this.live.get(dedupeKey)?.urgent) {
          return this.ready(job);
        }
        job.timer = setTimeout(() => this.ready(job), target.delayMs);
        job.timer.unref();
      })
      .catch((err) => {
        this.settle(dedupeKey);
        logger.debug(
          { file: target.file, err: (err as Error)?.message },
          'media info lookup failed'
        );
      });
    return dedupeKey;
  }

  /**
   * Waits up to `timeoutMs` for a queued probe to end, moving it ahead of the
   * others, and returns what it read. Returns at once when none is queued.
   */
  waitFor(
    dedupeKey: string,
    timeoutMs: number
  ): Promise<MediaInfoRecord | undefined> {
    const pending = this.live.get(dedupeKey);
    if (!pending || timeoutMs <= 0) return Promise.resolve(undefined);
    pending.urgent = true;
    for (const job of this.jobs.values()) {
      if (job.dedupeKey === dedupeKey && job.stage === 'waiting') {
        this.ready(job);
      }
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      void pending.settled.then((record) => {
        clearTimeout(timer);
        resolve(record);
      });
    });
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.ending = 'cancelled';
    if (job.abort) {
      job.abort.abort(new Error('cancelled'));
    } else {
      clearTimeout(job.timer);
      void this.finish(job, 'cancelled');
    }
    return true;
  }

  snapshot(): ProberSnapshot {
    const jobs = [...this.jobs.values()]
      .sort(
        (a, b) =>
          STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.queuedAt - b.queuedAt
      )
      .map((job) => ({
        id: job.id,
        releaseKey: job.releaseKey ?? '',
        file: job.file ?? '',
        path: job.target.path,
        kind: job.target.kind,
        reader: job.target.reader,
        stage: job.stage,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        bytesRead: job.bytesRead,
      }));
    return {
      enabled: appConfig.mediaInfo.probe,
      jobs,
      limits: {
        concurrency: appConfig.mediaInfo.maxConcurrentProbes,
        queue: appConfig.mediaInfo.maxQueuedProbes,
        timeoutSeconds: appConfig.mediaInfo.probeTimeout,
      },
      ffprobe: { path: appConfig.mediaInfo.ffprobePath, missing: this.missing },
    };
  }

  private ready(job: Job): void {
    clearTimeout(job.timer);
    job.timer = undefined;
    job.stage = 'queued';
    this.pump();
  }

  private settle(dedupeKey: string, record?: MediaInfoRecord): void {
    this.live.get(dedupeKey)?.settle(record);
    this.live.delete(dedupeKey);
  }

  private claim(dedupeKey: string): boolean {
    const now = Date.now();
    const last = this.recent.get(dedupeKey);
    if (last !== undefined && now - last < DEBOUNCE_MS) return false;
    if (this.recent.size > 1000) {
      for (const [key, at] of this.recent) {
        if (now - at >= DEBOUNCE_MS) this.recent.delete(key);
      }
    }
    this.recent.set(dedupeKey, now);
    return true;
  }

  private pump(): void {
    let running = [...this.jobs.values()].filter((j) => j.abort).length;
    const ready = [...this.jobs.values()]
      .filter((j) => j.stage === 'queued')
      .sort(
        (a, b) =>
          Number(!!this.live.get(b.dedupeKey)?.urgent) -
            Number(!!this.live.get(a.dedupeKey)?.urgent) ||
          a.queuedAt - b.queuedAt
      );
    for (const job of ready) {
      if (running >= appConfig.mediaInfo.maxConcurrentProbes) break;
      running++;
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    if (this.missing) return this.finish(job, 'failed', 'ffprobe not found');
    const abort = new AbortController();
    job.abort = abort;
    job.startedAt = Date.now();
    job.stage = 'opening';
    const timeout = setTimeout(() => {
      job.ending = 'timeout';
      abort.abort(new Error('timed out'));
    }, appConfig.mediaInfo.probeTimeout * 1000);
    timeout.unref();

    const path = appConfig.mediaInfo.ffprobePath;
    let outcome: ProbeOutcome = 'failed';
    let error: string | undefined;
    let record: MediaInfoRecord | undefined;
    try {
      const reader = await untilAborted(
        job.target.open(abort.signal),
        abort.signal
      );
      job.file ??= reader.name;
      job.stage = 'probing';
      record = await withLoopbackUrl(
        { ...reader, onRead: (bytes) => (job.bytesRead += bytes) },
        (url) => probeMediaInfo(path, url, abort.signal)
      );
      if (!record) {
        outcome = 'empty';
      } else if (job.target.releaseKeys.length && job.file) {
        const info = record;
        const file = job.file;
        await MediaInfoRepository.upsert(
          job.target.releaseKeys.map((releaseKey) => ({
            releaseKey,
            file,
            origin: LOCAL_ORIGIN,
            releaseFiles: job.target.releaseFiles,
            size: reader.size,
            info,
            version: MEDIA_INFO_VERSION,
            title: job.target.title,
          }))
        );
        outcome = 'stored';
      } else {
        outcome = 'applied';
      }
    } catch (err) {
      if (err instanceof FfprobeMissingError) {
        this.missingPath = path;
        error = 'ffprobe not found';
        logger.warn(
          { path },
          'ffprobe not found, so played files are not probed'
        );
      } else if (job.ending) {
        outcome = job.ending;
      } else {
        error = (err as Error)?.message ?? String(err);
      }
    } finally {
      clearTimeout(timeout);
    }
    await this.finish(job, outcome, error, record);
    if (record && outcome === 'stored' && job.file) {
      void job.target.onStored?.(record, job.file).catch(() => undefined);
    }
  }

  private async finish(
    job: Job,
    outcome: ProbeOutcome,
    error?: string,
    record?: MediaInfoRecord
  ): Promise<void> {
    this.jobs.delete(job.id);
    this.settle(job.dedupeKey, record);
    this.pump();
    const finishedAt = Date.now();
    logger.debug(
      {
        file: job.file,
        path: job.target.path,
        reader: job.target.reader,
        outcome,
        error,
        tracks: record?.tracks.length,
        latency: job.startedAt ? finishedAt - job.startedAt : undefined,
      },
      'media info probe finished'
    );
    await MediaInfoProbeRepository.record({
      id: job.id,
      releaseKey: job.releaseKey ?? '',
      file: job.file ?? '',
      path: job.target.path,
      kind: job.target.kind,
      reader: job.target.reader,
      outcome,
      error: error ?? null,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt ?? null,
      finishedAt,
      bytesRead: job.bytesRead,
      tracks: record?.tracks.length ?? null,
    }).catch((err) =>
      logger.debug(
        { err: (err as Error)?.message },
        'failed to record a media info probe'
      )
    );
    this.emit('finished', {
      releaseKeys: job.target.releaseKeys,
      outcome,
    } satisfies ProbeFinished);
  }
}

export const mediaInfoProber = new MediaInfoProber();
// One listener per open dashboard stream.
mediaInfoProber.setMaxListeners(50);
