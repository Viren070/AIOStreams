import { randomUUID } from 'crypto';

export type RepeatMode = 'RepeatOne' | 'RepeatAll' | 'RepeatNone';
export type ShuffleMode = 'Sorted' | 'Shuffle';
export type QueueMode = 'Queue' | 'QueueNext';

/** What a group plays, opaque to the queue: an item id, or a sealed reference. */
export interface QueueItem {
  ref: string;
  /** Unknown when 0, which leaves seeks unbounded. */
  runtimeMs: number;
}

export interface PlaylistItem extends QueueItem {
  playlistItemId: string;
}

const NONE = -1;

/** A queue less its items, which are stored apart. */
export interface SavedQueue {
  /** The shuffled order, as positions in the items. */
  shuffled?: number[];
  playingIndex: number;
  lastChange: number;
  shuffleMode: ShuffleMode;
  repeatMode: RepeatMode;
}

export const syncId = () => randomUUID().replace(/-/g, '');

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A group's playlist, with shuffle and repeat, as Jellyfin's SyncPlay keeps it. */
export class PlayQueue {
  private sorted: PlaylistItem[] = [];
  private shuffledList: PlaylistItem[] = [];
  playingIndex = NONE;
  lastChange: number;
  shuffleMode: ShuffleMode = 'Sorted';
  repeatMode: RepeatMode = 'RepeatNone';

  constructor(private readonly now: () => number = Date.now) {
    this.lastChange = now();
  }

  /** Items are never changed in place, so a restored queue shares them. */
  static restore(
    saved: SavedQueue,
    items: readonly PlaylistItem[],
    now?: () => number
  ): PlayQueue {
    const queue = new PlayQueue(now);
    queue.sorted = [...items];
    queue.shuffledList = saved.shuffled?.map((i) => items[i]) ?? [];
    queue.playingIndex = saved.playingIndex;
    queue.lastChange = saved.lastChange;
    queue.shuffleMode = saved.shuffleMode;
    queue.repeatMode = saved.repeatMode;
    return queue;
  }

  /** In order, unshuffled. */
  get items(): readonly PlaylistItem[] {
    return this.sorted;
  }

  save(): SavedQueue {
    const { sorted } = this;
    return {
      shuffled:
        this.shuffleMode === 'Shuffle'
          ? this.shuffledList.map((item) => sorted.indexOf(item))
          : undefined,
      playingIndex: this.playingIndex,
      lastChange: this.lastChange,
      shuffleMode: this.shuffleMode,
      repeatMode: this.repeatMode,
    };
  }

  private get list(): PlaylistItem[] {
    return this.shuffleMode === 'Shuffle' ? this.shuffledList : this.sorted;
  }

  private touch(): void {
    this.lastChange = this.now();
  }

  playlist(): readonly PlaylistItem[] {
    return this.list;
  }

  get size(): number {
    return this.sorted.length;
  }

  playing(): PlaylistItem | null {
    return this.playingIndex === NONE ? null : this.list[this.playingIndex];
  }

  playingId(): string {
    return this.playing()?.playlistItemId ?? '';
  }

  reset(): void {
    this.sorted = [];
    this.shuffledList = [];
    this.playingIndex = NONE;
    this.shuffleMode = 'Sorted';
    this.repeatMode = 'RepeatNone';
    this.touch();
  }

  setPlaylist(items: readonly QueueItem[]): void {
    this.sorted = entries(items);
    this.shuffledList =
      this.shuffleMode === 'Shuffle' ? shuffled(this.sorted) : [];
    this.playingIndex = NONE;
    this.touch();
  }

  queue(items: readonly QueueItem[], mode: QueueMode): void {
    const added = entries(items);
    if (mode === 'QueueNext') {
      if (this.shuffleMode === 'Shuffle') {
        const at = this.sorted.indexOf(this.playing()!);
        this.sorted.splice(at + 1, 0, ...added);
        this.shuffledList.splice(this.playingIndex + 1, 0, ...added);
      } else {
        this.sorted.splice(this.playingIndex + 1, 0, ...added);
      }
    } else {
      this.sorted.push(...added);
      if (this.shuffleMode === 'Shuffle') this.shuffledList.push(...added);
    }
    this.touch();
  }

  setPlayingIndex(index: number): void {
    this.playingIndex = index >= 0 && index < this.list.length ? index : NONE;
    this.touch();
  }

  setPlayingById(playlistItemId: string): boolean {
    this.playingIndex = this.list.findIndex(
      (item) => item.playlistItemId === playlistItemId
    );
    this.touch();
    return this.playingIndex !== NONE;
  }

  /** True when the playing item itself went. */
  remove(playlistItemIds: readonly string[]): boolean {
    const gone = new Set(playlistItemIds);
    const playing = this.playing();
    const before = playing
      ? this.list
          .slice(0, this.playingIndex)
          .filter((item) => gone.has(item.playlistItemId)).length
      : 0;
    this.sorted = this.sorted.filter((item) => !gone.has(item.playlistItemId));
    this.shuffledList = this.shuffledList.filter(
      (item) => !gone.has(item.playlistItemId)
    );
    this.touch();
    if (!playing) return false;
    if (gone.has(playing.playlistItemId)) {
      this.playingIndex -= before + 1;
      if (this.playingIndex < 0)
        this.playingIndex = this.list.length > 0 ? 0 : NONE;
      return true;
    }
    this.setPlayingById(playing.playlistItemId);
    return false;
  }

  clear(clearPlaying: boolean): void {
    const playing = this.playing();
    this.sorted = [];
    this.shuffledList = [];
    this.touch();
    if (!clearPlaying && playing) {
      this.sorted.push(playing);
      if (this.shuffleMode === 'Shuffle') this.shuffledList.push(playing);
      this.playingIndex = 0;
    } else {
      this.playingIndex = NONE;
    }
  }

  move(playlistItemId: string, newIndex: number): boolean {
    const list = this.list;
    const playing = this.playing();
    const from = list.findIndex(
      (item) => item.playlistItemId === playlistItemId
    );
    if (from < 0) return false;
    const [item] = list.splice(from, 1);
    list.splice(Math.min(Math.max(newIndex, 0), list.length), 0, item);
    this.playingIndex = playing ? list.indexOf(playing) : NONE;
    this.touch();
    return true;
  }

  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode = mode;
    this.touch();
  }

  setShuffleMode(mode: ShuffleMode): void {
    if (mode === 'Shuffle') this.shuffle();
    else this.unshuffle();
  }

  private shuffle(): void {
    if (this.playingIndex === NONE) {
      this.shuffledList = shuffled(this.sorted);
    } else {
      const playing = this.list[this.playingIndex];
      const rest = this.list.filter((_, i) => i !== this.playingIndex);
      this.shuffledList = [playing, ...shuffled(rest)];
      this.playingIndex = 0;
    }
    this.shuffleMode = 'Shuffle';
    this.touch();
  }

  private unshuffle(): void {
    if (this.playingIndex !== NONE && this.shuffledList.length > 0) {
      this.playingIndex = this.sorted.indexOf(
        this.shuffledList[this.playingIndex]
      );
    }
    this.shuffledList = [];
    this.shuffleMode = 'Sorted';
    this.touch();
  }

  next(): boolean {
    if (this.list.length === 0) return false;
    if (this.repeatMode === 'RepeatOne') {
      this.touch();
      return true;
    }
    this.playingIndex++;
    if (this.playingIndex >= this.sorted.length) {
      if (this.repeatMode !== 'RepeatAll') {
        this.playingIndex = this.sorted.length - 1;
        return false;
      }
      this.playingIndex = 0;
    }
    this.touch();
    return true;
  }

  previous(): boolean {
    if (this.list.length === 0) return false;
    if (this.repeatMode === 'RepeatOne') {
      this.touch();
      return true;
    }
    this.playingIndex--;
    if (this.playingIndex < 0) {
      if (this.repeatMode !== 'RepeatAll') {
        this.playingIndex = 0;
        return false;
      }
      this.playingIndex = this.sorted.length - 1;
    }
    this.touch();
    return true;
  }
}

function entries(items: readonly QueueItem[]): PlaylistItem[] {
  return items.map((item) => ({ ...item, playlistItemId: syncId() }));
}
