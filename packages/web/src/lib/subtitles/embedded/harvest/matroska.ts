import { concat, readAll, ReadError } from '@/lib/byte-reader';
import {
  blockTrack,
  clusterHead,
  readBlock,
  type Block,
  type ClusterHead,
} from '@/lib/subtitles/matroska/blocks';
import {
  BLOCK_GROUP,
  CLUSTER,
  SIMPLE_BLOCK,
  head,
} from '@/lib/subtitles/matroska/ebml';
import {
  blockText,
  decoded,
  type CueEntry,
  type MkvFile,
  type MkvSubtitle,
} from '@/lib/subtitles/matroska/file';
import {
  MERGE_GAP,
  MERGE_SPAN,
  SubtitleHarvest,
  WINDOWED_OVER,
  type HarvestedEvent,
  type HarvestTask,
  type ReadPace,
  type SuppliedBlock,
} from '.';

const MAX_BLOCK = 4 * 1024 * 1024;
const BLOCK_READ = 4096;
const SCAN_WINDOW = 64 * 1024;
const DEFAULT_DURATION_MS = 5000;

const earliest = (entries: CueEntry[]) =>
  entries.reduce((ms, entry) => Math.min(ms, entry.timeMs), Infinity);

/** Reads the blocks the index points at, or walks the clusters where it has none. */
export class MatroskaHarvest extends SubtitleHarvest {
  private readonly clusters = new Map<number, Promise<ClusterHead | null>>();
  private readonly heads = new Map<number, ClusterHead>();
  private readonly scanned = new Map<number, Promise<unknown>>();

  constructor(
    private readonly file: MkvFile,
    override readonly track: MkvSubtitle,
    pace?: ReadPace
  ) {
    super(track, pace);
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

  protected override forget(): void {
    this.scanned.clear();
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

  override async supplyBlock(block: SuppliedBlock): Promise<void> {
    const payload = await decoded(block.data, this.track.encoding, 1);
    const picture = this.track.kind === 'pgs';
    this.supply({
      startMs: block.timestampMs,
      endMs: block.timestampMs + (block.durationMs ?? DEFAULT_DURATION_MS),
      text: picture ? '' : blockText(this.track, payload),
      ...(picture && { data: payload }),
    });
  }

  private async keepBlock(
    at: number,
    block: Block,
    cluster: ClusterHead,
    task: HarvestTask,
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
    this.keep(at, event, task);
  }

  /** Read together with the cluster's head where it is near. */
  private async readRun(
    clusterAt: number,
    run: CueEntry[],
    task: HarvestTask
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
      if (block) await this.keepBlock(at, block, cluster, task, entry);
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

  private async scanCluster(at: number, task: HarvestTask): Promise<void> {
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
    task: HarvestTask
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
            if (block) await this.keepBlock(next, block, cluster, task);
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
