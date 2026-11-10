import { concat, readAll, ReadError } from '../../byte-reader';
import {
  blockTrack,
  clusterHead,
  readBlock,
  type Block,
  type ClusterHead,
} from '../matroska/blocks';
import { BLOCK_GROUP, CLUSTER, SIMPLE_BLOCK, head } from '../matroska/ebml';
import {
  blockText,
  decoded,
  type CueEntry,
  type MkvFile,
  type MkvSubtitle,
} from '../matroska/file';

const MAX_BLOCK = 4 * 1024 * 1024;
const BLOCK_READ = 4096;
const SCAN_WINDOW = 64 * 1024;
const DEFAULT_DURATION_MS = 5000;

export interface HarvestedEvent {
  startMs: number;
  endMs: number;
  /** An ASS event's fields after its times, or a caption. */
  text: string;
  /** A picture track's block. */
  data?: Uint8Array;
}

const sizeOf = (event: HarvestedEvent) =>
  event.text.length + (event.data?.length ?? 0);

interface Task {
  timeMs: number;
  run(task: Task): Promise<void>;
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
const MERGE_GAP = 64 * 1024;
const MERGE_SPAN = 256 * 1024;
const SCAN_BUFFER_MS = 20_000;
/** A track past this many blocks is read only near the playhead; what is far from it is dropped past KEEP_SIZE. */
const WINDOWED_OVER = 8000;
const KEEP_SIZE = 4 * 1024 * 1024;
/** For a block that won't parse, not a failed read. */
const BAD_BLOCK_TRIES = 3;
/** Failed reads before any worked that hand the track to the TV's player while reading goes on. */
const TROUBLE_AFTER = 2;
const RETRY_MS = [2000, 5000, 15_000, 30_000, 60_000];

const earliest = (entries: CueEntry[]) =>
  entries.reduce((ms, entry) => Math.min(ms, entry.timeMs), Infinity);

/** Nearest the playhead first, then the rest in the background. */
export class SubtitleHarvest {
  readonly events = new Map<number, HarvestedEvent>();
  onUpdate: (event: HarvestedEvent) => void = () => {};
  /** `lasting` when the host refused for good; otherwise reading goes on. */
  onFail: (error: unknown, lasting: boolean) => void = () => {};
  private readonly tasks: Task[] = [];
  private readonly clusters = new Map<number, Promise<ClusterHead | null>>();
  private readonly heads = new Map<number, ClusterHead>();
  private readonly scanned = new Map<number, Promise<unknown>>();
  private readonly windowed: boolean;
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
  /** No index for the track: the clusters are walked near the playhead only. */
  private scanning = false;
  private waiters: { untilMs: number; resolve: () => void }[] = [];

  constructor(
    private readonly file: MkvFile,
    readonly track: MkvSubtitle,
    private readonly lanes: () => number = () => 1
  ) {
    const cues = file.cues.get(track.number) ?? [];
    this.windowed = cues.length > WINDOWED_OVER;
    const byCluster = new Map<number, CueEntry[]>();
    for (const cue of cues) {
      const list = byCluster.get(cue.cluster) ?? [];
      list.push(cue);
      byCluster.set(cue.cluster, list);
    }
    for (const [cluster, entries] of byCluster) this.plan(cluster, entries);
    if (!cues.length) this.scanAll();
    this.tasks.sort((a, b) => a.timeMs - b.timeMs);
  }

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

  pause(): void {
    this.active = false;
    window.clearTimeout(this.timer);
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

  private add(
    timeMs: number,
    run: (task: Task) => Promise<void>,
    heavy = false
  ): Task {
    const task: Task = {
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

  /** One read per run of nearby blocks, and the whole cluster where the index leaves a block's place out. */
  private plan(cluster: number, entries: CueEntry[]): void {
    if (entries.some((entry) => entry.relative === undefined)) {
      this.add(
        earliest(entries),
        (task) => this.scanCluster(cluster, task),
        true
      );
      return;
    }
    const sorted = [...entries].sort((a, b) => a.relative! - b.relative!);
    let run: CueEntry[] = [];
    const flush = () => {
      if (!run.length) return;
      const group = run;
      run = [];
      this.add(earliest(group), (task) => this.readRun(cluster, group, task));
    };
    for (const entry of sorted) {
      const first = run[0]?.relative ?? 0;
      const last = run[run.length - 1]?.relative ?? 0;
      if (
        run.length &&
        (entry.relative! - last > MERGE_GAP ||
          entry.relative! - first + BLOCK_READ > MERGE_SPAN)
      )
        flush();
      run.push(entry);
    }
    flush();
  }

  private scanAll(): void {
    this.scanning = true;
    const { clusters, firstCluster } = this.file;
    if (clusters.length) {
      clusters.forEach((cluster, i) => {
        const until = clusters[i + 1]?.at ?? Infinity;
        this.add(
          cluster.timeMs,
          async (task) => {
            await this.scan(cluster.at, until, task);
          },
          true
        );
      });
      return;
    }
    // No index at all: one cluster after another, from the first.
    const walk = (at: number, timeMs: number) => {
      const task = this.add(
        timeMs,
        async (self) => {
          const next = await this.scan(at, at + 1, self);
          if (next === null) return;
          const cluster = await this.cluster(next);
          if (cluster) walk(next, this.toMs(cluster.timestamp ?? 0));
        },
        true
      );
      this.tasks.pop();
      const after = this.tasks.findIndex((other) => other.timeMs > timeMs);
      this.tasks.splice(after < 0 ? this.tasks.length : after, 0, task);
    };
    if (firstCluster !== undefined) walk(firstCluster, 0);
  }

  private toMs(units: number): number {
    return units * this.file.scaleMs;
  }

  private next(): Task | undefined {
    const now = Date.now();
    const from = this.positionMs - BEHIND_MS;
    const to = this.positionMs + AHEAD_MS;
    const ready = (task: Task) =>
      task.state === 'waiting' &&
      task.retryAt <= now &&
      (!task.heavy || this.roomy);
    const near = this.tasks.find(
      (task) => ready(task) && task.timeMs >= from && task.timeMs <= to
    );
    if (near) return near;
    if (this.running > 0 || this.scanning || this.windowed) return;
    const later = (task: Task) => ready(task) && !task.heavy;
    return (
      this.tasks.find((task) => later(task) && task.timeMs > to) ??
      this.tasks.find(later)
    );
  }

  private pump(): void {
    if (!this.active || this.failed) return;
    window.clearTimeout(this.timer);
    while (this.running < this.lanes()) {
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

  private failedTask(task: Task, error: unknown): void {
    task.state = 'waiting';
    if (error instanceof ReadError && error.lasting) {
      this.failed = true;
      this.onFail(error, true);
      return;
    }
    task.tries++;
    if (!(error instanceof ReadError) && task.tries >= BAD_BLOCK_TRIES) {
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
    const distance = (task: Task) => Math.abs(task.timeMs - this.positionMs);
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
    this.scanned.clear();
  }

  private cluster(at: number): Promise<ClusterHead | null> {
    let known = this.clusters.get(at);
    if (!known) {
      known = readAll(this.file.reader, at, 64).then((bytes) => {
        const found = clusterHead(bytes, at);
        if (found) this.heads.set(at, found);
        return found;
      });
      known.catch(() => this.clusters.delete(at));
      this.clusters.set(at, known);
    }
    return known;
  }

  private async keep(
    at: number,
    block: Block,
    cluster: ClusterHead,
    task: Task,
    cue?: CueEntry
  ): Promise<void> {
    if (block.track !== this.track.number || this.events.has(at)) return;
    const startMs =
      cluster.timestamp !== undefined
        ? this.toMs(cluster.timestamp + block.relative)
        : (cue?.timeMs ?? 0);
    const durationMs =
      block.duration !== undefined
        ? this.toMs(block.duration)
        : (cue?.durationMs ?? DEFAULT_DURATION_MS);
    const payload = await decoded(block.payload, this.track.encoding, 1);
    const picture = this.track.kind === 'pgs';
    const event: HarvestedEvent = {
      startMs,
      endMs: startMs + durationMs,
      text: picture ? '' : blockText(this.track, payload),
      ...(picture && { data: payload }),
    };
    this.events.set(at, event);
    this.held += sizeOf(event);
    task.kept.push(at);
    this.onUpdate(event);
  }

  /** Read together with the cluster's head where it is near. */
  private async readRun(
    clusterAt: number,
    run: CueEntry[],
    task: Task
  ): Promise<void> {
    const first = run[0].relative!;
    const last = run[run.length - 1].relative!;
    let cluster = this.heads.get(clusterAt) ?? null;
    let bytes: Uint8Array = new Uint8Array();
    let bytesAt = 0;
    if (!cluster && first <= MERGE_GAP) {
      // An id and a size take at most twelve bytes.
      bytesAt = clusterAt;
      bytes = await readAll(
        this.file.reader,
        clusterAt,
        12 + last + BLOCK_READ
      );
      cluster = clusterHead(bytes, clusterAt);
      if (cluster) {
        this.heads.set(clusterAt, cluster);
        this.clusters.set(clusterAt, Promise.resolve(cluster));
      }
    } else {
      cluster = await this.cluster(clusterAt);
      if (cluster) {
        bytesAt = cluster.data + first;
        bytes = await readAll(
          this.file.reader,
          bytesAt,
          last - first + BLOCK_READ
        );
      }
    }
    if (!cluster) throw new Error('The index points at no cluster');
    let misplaced = false;
    for (const entry of run) {
      const at = cluster.data + entry.relative!;
      const block = await this.blockAt(at, bytes, bytesAt);
      if (block) await this.keep(at, block, cluster, task, entry);
      else misplaced = true;
    }
    // An index that points beside the block still names its cluster.
    if (misplaced) await this.scanCluster(clusterAt, task);
  }

  /** From `bytes` where they hold it, else a read. */
  private async blockAt(
    at: number,
    bytes: Uint8Array,
    bytesAt: number
  ): Promise<Block | null> {
    const offset = at - bytesAt;
    let local =
      offset >= 0 && offset + 16 <= bytes.length
        ? bytes.subarray(offset)
        : await readAll(this.file.reader, at, BLOCK_READ);
    const found = head(local, 0);
    if (
      !found ||
      (found.id !== BLOCK_GROUP && found.id !== SIMPLE_BLOCK) ||
      found.size < 0 ||
      found.size > MAX_BLOCK ||
      blockTrack(local.subarray(0, 64), found) !== this.track.number
    )
      return null;
    const total = found.length + found.size;
    if (local.length < total) {
      const rest = await readAll(
        this.file.reader,
        at + local.length,
        total - local.length
      );
      if (local.length + rest.length < total)
        // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
        throw new ReadError('The block was cut short', false);
      local = concat([local, rest], total);
    }
    return readBlock(local.subarray(0, total), found);
  }

  private async scanCluster(at: number, task: Task): Promise<void> {
    let scanned = this.scanned.get(at);
    if (!scanned) {
      scanned = this.scan(at, at + 1, task);
      scanned.catch(() => this.scanned.delete(at));
      this.scanned.set(at, scanned);
    }
    await scanned;
  }

  /** Returns where the walk stopped, or null at the end of the file. */
  private async scan(
    from: number,
    until: number,
    task: Task
  ): Promise<number | null> {
    let at = from;
    while (at < until) {
      const cluster = await this.cluster(at);
      if (!cluster) return null;
      let next = cluster.data;
      let chunk: Uint8Array = new Uint8Array();
      let chunkAt = next;
      // Past a big video block the next header is all that's needed.
      let skipped = false;
      const ensure = async (position: number, length: number) => {
        if (position >= chunkAt && position + length <= chunkAt + chunk.length)
          return;
        chunkAt = position;
        chunk = await readAll(
          this.file.reader,
          position,
          Math.max(length, skipped ? BLOCK_READ : SCAN_WINDOW)
        );
      };
      while (next < cluster.end) {
        await ensure(next, 32);
        const offset = next - chunkAt;
        const found = head(chunk, offset);
        if (!found) return null;
        if (found.id === CLUSTER || found.size < 0) break;
        const end = next + found.length + found.size;
        if (found.id === SIMPLE_BLOCK || found.id === BLOCK_GROUP) {
          const track = blockTrack(
            chunk.subarray(offset, Math.min(chunk.length, offset + 64)),
            found
          );
          if (track === this.track.number && found.size <= MAX_BLOCK) {
            await ensure(next, found.length + found.size);
            const bytes = chunk.subarray(next - chunkAt, end - chunkAt);
            const block = readBlock(bytes, found);
            if (block) await this.keep(next, block, cluster, task);
          }
        }
        skipped = found.length + found.size > SCAN_WINDOW;
        next = end;
      }
      at = next;
    }
    return at;
  }
}
