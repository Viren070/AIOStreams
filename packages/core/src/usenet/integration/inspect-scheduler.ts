import { appConfig } from '../../utils/index.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('usenet/inspect-scheduler');

/**
 * Dispatch tiers, best first. Playback resolves are interactive (a player is
 * blocked on the result); manual adds / SABnzbd retries run behind them; boot
 * requeues of restart-interrupted inspects go last.
 */
export type InspectPriority = 'interactive' | 'background' | 'requeue';

const PRIORITY_RANK: Record<InspectPriority, number> = {
  interactive: 0,
  background: 1,
  requeue: 2,
};

export interface InspectScheduleOptions<T> {
  contentHash: string;
  priority: InspectPriority;
  /**
   * The waiter's abort signal. The underlying job is only cancelled once
   * EVERY waiter has aborted; a waiter without a signal pins the job to
   * completion.
   */
  signal?: AbortSignal;
  /** The inspect work; receives the job's own (refcounted) abort signal. */
  run: (signal: AbortSignal) => Promise<T>;
}

interface InspectJob {
  contentHash: string;
  priority: InspectPriority;
  seq: number;
  state: 'queued' | 'running';
  run: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  /** Waiters that can still abort or are unabortable; 0 ⇒ cancel the job. */
  liveWaiters: number;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

function abortError(): Error {
  return Object.assign(new Error('nzb inspect cancelled'), {
    name: 'AbortError',
  });
}

/**
 * In-process dispatcher for NZB inspects (the segment-probing import phase).
 * Deduplicates concurrent inspects of the same content hash, bounds how many
 * run at once (`usenet.maxConcurrentInspects`), and serves interactive work first.
 */
export class InspectScheduler {
  private readonly jobs = new Map<string, InspectJob>();
  private running = 0;
  private seq = 0;

  /** Live jobs snapshot (dashboards/tests). */
  stats(): { queued: number; running: number } {
    return { queued: this.jobs.size - this.running, running: this.running };
  }

  schedule<T>(opts: InspectScheduleOptions<T>): Promise<T> {
    if (opts.signal?.aborted) return Promise.reject(abortError());

    let job = this.jobs.get(opts.contentHash);
    if (!job) {
      let resolve!: (value: unknown) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(() => {});
      job = {
        contentHash: opts.contentHash,
        priority: opts.priority,
        seq: this.seq++,
        state: 'queued',
        run: opts.run as (signal: AbortSignal) => Promise<unknown>,
        controller: new AbortController(),
        liveWaiters: 0,
        promise,
        resolve,
        reject,
      };
      this.jobs.set(opts.contentHash, job);
      logger.debug(
        { hash: opts.contentHash, priority: opts.priority, ...this.stats() },
        'inspect queued'
      );
      queueMicrotask(() => this.dispatch());
    } else {
      // Join the in-flight job; an interactive joiner pulls a still-queued
      // background job forward.
      if (
        job.state === 'queued' &&
        PRIORITY_RANK[opts.priority] < PRIORITY_RANK[job.priority]
      ) {
        job.priority = opts.priority;
      }
      logger.debug(
        { hash: opts.contentHash, priority: opts.priority, state: job.state },
        'joined in-flight inspect'
      );
    }
    return this.attachWaiter(job, opts.signal) as Promise<T>;
  }

  private attachWaiter(
    job: InspectJob,
    signal?: AbortSignal
  ): Promise<unknown> {
    job.liveWaiters++;
    if (!signal) return job.promise;
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        job.liveWaiters--;
        if (job.liveWaiters <= 0) this.cancel(job);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      job.promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (err) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  /** Every waiter is gone: drop a queued job, or abort a running one. */
  private cancel(job: InspectJob): void {
    if (this.jobs.get(job.contentHash) !== job) return;
    logger.debug(
      { hash: job.contentHash, state: job.state },
      'inspect cancelled (all waiters aborted)'
    );
    if (job.state === 'queued') {
      this.jobs.delete(job.contentHash);
      job.reject(abortError());
    } else {
      // The run sees the abort through its signal and settles itself.
      job.controller.abort();
    }
  }

  /** 0 = unlimited; read live so a settings edit applies to the next pick. */
  private limit(): number {
    const cap = Number(appConfig.usenet.maxConcurrentInspects ?? 0);
    return Number.isFinite(cap) && cap > 0 ? cap : Infinity;
  }

  private pickNext(): InspectJob | undefined {
    let best: InspectJob | undefined;
    for (const job of this.jobs.values()) {
      if (job.state !== 'queued') continue;
      if (
        !best ||
        PRIORITY_RANK[job.priority] < PRIORITY_RANK[best.priority] ||
        (PRIORITY_RANK[job.priority] === PRIORITY_RANK[best.priority] &&
          job.seq < best.seq)
      ) {
        best = job;
      }
    }
    return best;
  }

  private dispatch(): void {
    while (this.running < this.limit()) {
      const job = this.pickNext();
      if (!job) return;
      this.start(job);
    }
  }

  private start(job: InspectJob): void {
    job.state = 'running';
    this.running++;
    const startedAt = Date.now();
    void (async () => {
      try {
        const result = await job.run(job.controller.signal);
        job.resolve(result);
      } catch (err) {
        job.reject(err);
      } finally {
        this.running--;
        if (this.jobs.get(job.contentHash) === job) {
          this.jobs.delete(job.contentHash);
        }
        logger.debug(
          {
            hash: job.contentHash,
            priority: job.priority,
            latency: Date.now() - startedAt,
            ...this.stats(),
          },
          'inspect settled'
        );
        this.dispatch();
      }
    })();
  }
}

/** Process-wide scheduler shared by the resolve, manual-add and boot paths. */
export const inspectScheduler = new InspectScheduler();
