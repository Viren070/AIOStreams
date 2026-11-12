import { ReadError } from '@/lib/byte-reader';
import type { FileSubtitle } from '@/lib/subtitles/file-subtitle';

export interface HarvestedEvent {
  startMs: number;
  endMs: number;
  /** An ASS event's fields after its times, or a caption. */
  text: string;
  /** A picture track's block. */
  data?: Uint8Array;
}

/** How many reads may run at once, and asks for more while lines near the playhead are unread. */
export interface ReadPace {
  readonly lanes: number;
  hurry(on: boolean): void;
}

const STEADY: ReadPace = { lanes: 1, hurry() {} };

const sizeOf = (event: HarvestedEvent) =>
  event.text.length + (event.data?.length ?? 0);

/** A block as the player read it with the video, in the file's time. */
export interface SuppliedBlock {
  trackNumber: number;
  timestampMs: number;
  durationMs: number | null;
  data: Uint8Array;
}

export interface HarvestTask {
  timeMs: number;
  run(task: HarvestTask): Promise<void>;
  state: 'waiting' | 'running' | 'done';
  tries: number;
  retryAt: number;
  /** Walks whole clusters, so it waits for the video to buffer. */
  heavy: boolean;
  /** Where the events it kept start, so a windowed harvest can drop them. */
  kept: number[];
}

const AHEAD_MS = 90_000;
const BEHIND_MS = 10_000;
/** Lines this little before the playhead are read with those ahead of it, before older ones. */
const NOW_MS = 2000;
/** Unread lines this close ahead make the reads hurry. */
const HURRY_AHEAD_MS = 15_000;
export const MERGE_GAP = 64 * 1024;
export const MERGE_SPAN = 256 * 1024;
const SCAN_BUFFER_MS = 20_000;
/** A track past this many lines is read only near the playhead; what is far from it is dropped past KEEP_SIZE. */
export const WINDOWED_OVER = 8000;
const KEEP_SIZE = 4 * 1024 * 1024;
/** For a line that won't parse, not a failed read. */
const BAD_TRIES = 3;
/** Failed reads before any worked that hand the track to the TV's player while reading goes on. */
const TROUBLE_AFTER = 2;
const RETRY_MS = [2000, 5000, 15_000, 30_000, 60_000];

/** Nearest the playhead first, then the rest in the background. */
export abstract class SubtitleHarvest {
  readonly events = new Map<number, HarvestedEvent>();
  onUpdate: (event: HarvestedEvent) => void = () => {};
  /** `lasting` when the host refused for good; otherwise reading goes on. */
  onFail: (error: unknown, lasting: boolean) => void = () => {};
  protected readonly tasks: HarvestTask[] = [];
  protected windowed = false;
  /** No index for the track: the file is walked near the playhead only. */
  protected scanning = false;
  private running = 0;
  private positionMs = 0;
  private active = false;
  private failed = false;
  private worked = false;
  private troubled = false;
  private failures = 0;
  private roomy = true;
  private held = 0;
  private timer = 0;
  private waiters: { untilMs: number; resolve: () => void }[] = [];
  private supplied = false;
  private readonly suppliedKeys = new Set<string>();
  private nextSupplied = -1;

  constructor(
    readonly track: FileSubtitle,
    private readonly pace: ReadPace = STEADY
  ) {}

  /** `ms` is the file's own time. A harvest that gave up tries again. */
  start(ms: number): void {
    this.active = true;
    this.positionMs = ms;
    if (this.failed) {
      this.failed = false;
      this.failures = 0;
    }
    this.pump();
  }

  setPosition(ms: number): void {
    if (Math.abs(ms - this.positionMs) < 1000) return;
    this.positionMs = ms;
    if (this.active) this.pump();
  }

  /** `aheadMs` is null where the player doesn't say. */
  setBuffered(aheadMs: number | null): void {
    const roomy = aheadMs === null || aheadMs >= SCAN_BUFFER_MS;
    if (roomy === this.roomy) return;
    this.roomy = roomy;
    if (roomy && this.active) this.pump();
  }

  /** The player hands over the track's lines as it reads the file, so nothing is read for them from here on. */
  fromPlayer(): void {
    this.supplied = true;
  }

  supplyBlock(_block: SuppliedBlock): Promise<void> {
    return Promise.resolve();
  }

  /** Keyed apart from file positions, by content, as a cluster the player reads again sends its blocks again. */
  protected supply(event: HarvestedEvent): void {
    const key = `${event.startMs}:${event.endMs}:${event.text}:${event.data?.length ?? 0}`;
    if (this.suppliedKeys.has(key)) return;
    this.suppliedKeys.add(key);
    this.events.set(this.nextSupplied--, event);
    this.held += sizeOf(event);
    this.onUpdate(event);
    if (this.held > KEEP_SIZE) this.dropFarSupplied();
  }

  private dropFarSupplied(): void {
    const from = this.positionMs - BEHIND_MS - 60_000;
    const to = this.positionMs + AHEAD_MS + 60_000;
    for (const [at, event] of this.events) {
      if (this.held <= KEEP_SIZE * 0.75) break;
      if (at >= 0 || (event.endMs >= from && event.startMs <= to)) continue;
      this.events.delete(at);
      this.held -= sizeOf(event);
      this.suppliedKeys.delete(
        `${event.startMs}:${event.endMs}:${event.text}:${event.data?.length ?? 0}`
      );
    }
  }

  pause(): void {
    this.active = false;
    window.clearTimeout(this.timer);
    this.pace.hurry(false);
  }

  /** Resolves once everything up to `untilMs` is read, or it can't be. */
  settled(untilMs: number): Promise<void> {
    if (this.covered(untilMs)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ untilMs, resolve }));
  }

  private covered(untilMs: number): boolean {
    if (this.failed) return true;
    const from = this.positionMs - BEHIND_MS;
    return this.tasks.every(
      (task) =>
        task.state === 'done' ||
        task.timeMs < from ||
        task.timeMs > untilMs ||
        task.tries > 0
    );
  }

  protected add(
    timeMs: number,
    run: (task: HarvestTask) => Promise<void>,
    heavy = false
  ): HarvestTask {
    const task: HarvestTask = {
      timeMs,
      run,
      state: 'waiting',
      tries: 0,
      retryAt: 0,
      heavy,
      kept: [],
    };
    this.tasks.push(task);
    return task;
  }

  /** `at` is where it starts in the file. */
  protected keep(at: number, event: HarvestedEvent, task: HarvestTask): void {
    if (this.events.has(at)) return;
    this.events.set(at, event);
    this.held += sizeOf(event);
    task.kept.push(at);
    this.onUpdate(event);
  }

  /** Drops what a subclass remembers of its reads, after a trim. */
  protected forget(): void {}

  private next(): HarvestTask | undefined {
    const now = Date.now();
    const from = this.positionMs - BEHIND_MS;
    const to = this.positionMs + AHEAD_MS;
    const ready = (task: HarvestTask) =>
      task.state === 'waiting' &&
      task.retryAt <= now &&
      (!task.heavy || this.roomy);
    const near =
      this.tasks.find(
        (task) =>
          ready(task) &&
          task.timeMs >= this.positionMs - NOW_MS &&
          task.timeMs <= to
      ) ??
      this.tasks.find(
        (task) => ready(task) && task.timeMs >= from && task.timeMs <= to
      );
    if (near) return near;
    if (this.running > 0 || this.scanning || this.windowed) return;
    const later = (task: HarvestTask) => ready(task) && !task.heavy;
    return (
      this.tasks.find((task) => later(task) && task.timeMs > to) ??
      this.tasks.find(later)
    );
  }

  private pump(): void {
    if (!this.active || this.failed || this.supplied)
      return this.pace.hurry(false);
    window.clearTimeout(this.timer);
    while (this.running < this.pace.lanes) {
      const task = this.next();
      if (!task) break;
      task.state = 'running';
      this.running++;
      task
        .run(task)
        .then(
          () => {
            task.state = 'done';
            this.worked = true;
            this.troubled = false;
            this.failures = 0;
            if (this.windowed) this.trim();
          },
          (error: unknown) => this.failedTask(task, error)
        )
        .finally(() => {
          this.running--;
          this.release();
          this.pump();
        });
    }
    const now = Date.now();
    const urgent = this.positionMs + HURRY_AHEAD_MS;
    this.pace.hurry(
      this.tasks.some(
        (task) =>
          task.state === 'waiting' &&
          task.retryAt <= now &&
          (!task.heavy || this.roomy) &&
          task.timeMs >= this.positionMs - NOW_MS &&
          task.timeMs <= urgent
      )
    );
    const soonest = this.tasks.reduce(
      (at, task) =>
        task.state === 'waiting' && task.retryAt > now
          ? Math.min(at, task.retryAt)
          : at,
      Infinity
    );
    if (this.running === 0 && Number.isFinite(soonest)) {
      this.timer = window.setTimeout(
        () => this.pump(),
        Math.max(soonest - now, 250)
      );
    }
  }

  private failedTask(task: HarvestTask, error: unknown): void {
    task.state = 'waiting';
    if (error instanceof ReadError && error.lasting) {
      this.failed = true;
      this.onFail(error, true);
      return;
    }
    task.tries++;
    if (!(error instanceof ReadError) && task.tries >= BAD_TRIES) {
      task.state = 'done';
      return;
    }
    task.retryAt =
      Date.now() + RETRY_MS[Math.min(task.tries, RETRY_MS.length) - 1];
    this.failures++;
    if (!this.worked && !this.troubled && this.failures >= TROUBLE_AFTER) {
      this.troubled = true;
      this.onFail(error, false);
    }
  }

  private release(): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (!this.covered(waiter.untilMs)) return true;
      waiter.resolve();
      return false;
    });
  }

  private trim(): void {
    if (this.held <= KEEP_SIZE) return;
    const from = this.positionMs - BEHIND_MS - 60_000;
    const to = this.positionMs + AHEAD_MS + 60_000;
    const distance = (task: HarvestTask) =>
      Math.abs(task.timeMs - this.positionMs);
    const far = this.tasks
      .filter(
        (task) =>
          task.state === 'done' &&
          task.kept.length &&
          (task.timeMs < from || task.timeMs > to)
      )
      .sort((a, b) => distance(b) - distance(a));
    for (const task of far) {
      if (this.held <= KEEP_SIZE * 0.75) break;
      for (const at of task.kept) {
        const event = this.events.get(at);
        if (!event) continue;
        this.held -= sizeOf(event);
        this.events.delete(at);
      }
      task.kept = [];
      task.state = 'waiting';
      task.tries = 0;
    }
    this.forget();
  }
}
