import {
  syncId,
  PlayQueue,
  type PlaylistItem,
  type SavedQueue,
  type QueueItem,
  type QueueMode,
  type RepeatMode,
  type ShuffleMode,
} from './queue.js';

/*
 * A watch-together group, ported from Jellyfin's SyncPlay (Group and its four
 * GroupStates) so stock clients behave as they do against Jellyfin. The group
 * keeps the position and the moment it applies; members sync to it themselves.
 */

export type GroupStateType = 'Idle' | 'Waiting' | 'Paused' | 'Playing';
export type CommandType = 'Unpause' | 'Pause' | 'Stop' | 'Seek';
export type QueueUpdateReason =
  | 'NewPlaylist'
  | 'SetCurrentItem'
  | 'RemoveItems'
  | 'MoveItem'
  | 'Queue'
  | 'QueueNext'
  | 'NextItem'
  | 'PreviousItem'
  | 'RepeatMode'
  | 'ShuffleMode';

export type GroupRequest =
  | { type: 'Play'; items: QueueItem[]; index: number; startMs: number }
  | { type: 'SetPlaylistItem'; playlistItemId: string }
  | {
      type: 'RemoveFromPlaylist';
      playlistItemIds: string[];
      clearPlaylist: boolean;
      clearPlayingItem: boolean;
    }
  | { type: 'MovePlaylistItem'; playlistItemId: string; newIndex: number }
  | { type: 'Queue'; items: QueueItem[]; mode: QueueMode }
  | { type: 'Unpause' }
  | { type: 'Pause' }
  | { type: 'Stop' }
  | { type: 'Seek'; positionMs: number }
  | {
      type: 'Buffer' | 'Ready';
      /** When the member was at `positionMs`, on the group's clock. */
      when: number;
      positionMs: number;
      isPlaying: boolean;
      playlistItemId: string;
    }
  | { type: 'NextItem' | 'PreviousItem'; playlistItemId: string }
  | { type: 'SetRepeatMode'; mode: RepeatMode }
  | { type: 'SetShuffleMode'; mode: ShuffleMode }
  | { type: 'Ping'; ping: number }
  | { type: 'IgnoreWait'; ignoreWait: boolean };

export type RequestType = GroupRequest['type'];

export interface GroupCommand {
  playlistItemId: string;
  /** When to act, on the group's clock. */
  when: number;
  positionMs: number;
  command: CommandType;
  emittedAt: number;
}

export interface QueueSnapshot {
  reason: QueueUpdateReason;
  lastUpdate: number;
  playlist: PlaylistItem[];
  playingIndex: number;
  startPositionMs: number;
  isPlaying: boolean;
  shuffleMode: ShuffleMode;
  repeatMode: RepeatMode;
}

export interface GroupInfo {
  id: string;
  name: string;
  state: GroupStateType;
  participants: string[];
  lastUpdatedAt: number;
}

export interface GroupMember {
  id: string;
  name: string;
  ping: number;
  buffering: boolean;
  ignoreWait: boolean;
}

export type GroupMessage =
  | { kind: 'joined'; info: GroupInfo }
  | { kind: 'left' }
  | { kind: 'user-joined'; member: GroupMember }
  | { kind: 'user-left'; member: GroupMember }
  | { kind: 'command'; command: GroupCommand }
  | { kind: 'queue'; queue: QueueSnapshot }
  | { kind: 'state'; state: GroupStateType; reason: RequestType };

export type GroupSend = (to: readonly string[], message: GroupMessage) => void;

export interface PlayingOnCreate {
  items: QueueItem[];
  index: number;
  positionMs: number;
  paused: boolean;
}

export const DEFAULT_PING_MS = 500;
const MAX_PING_MS = 10_000;
const PING_STEP_MS = 50;
/** Beyond this a member's clock is taken to be wrong. */
const TIME_SYNC_OFFSET_MS = 2_000;
const MAX_PLAYBACK_OFFSET_MS = 500;
/** How far a member catching up after buffering may lag. */
const MAX_CATCH_UP_OFFSET_MS = 60_000;
/** Opening a new item can take a while; buffering mid-play gets less. */
export const LOAD_WAIT_MS = 30_000;
export const BUFFER_WAIT_MS = 10_000;

const clampPing = (ping: number) =>
  Math.min(Math.max(ping || 0, 0), MAX_PING_MS);

type State =
  | { type: 'Idle' }
  | { type: 'Paused' }
  | { type: 'Playing'; ignoreBuffering: boolean }
  | {
      type: 'Waiting';
      resumePlaying: boolean;
      initial: GroupStateType | null;
      positionJumped: boolean;
    };

type Waiting = Extract<State, { type: 'Waiting' }>;

export interface SavedGroup {
  id: string;
  name: string;
  state: State;
  members: GroupMember[];
  runtimeMs: number;
  positionMs: number;
  lastActivity: number;
  waitDeadline: number | null;
  queue: SavedQueue;
}
type Report = Extract<GroupRequest, { type: 'Buffer' | 'Ready' }>;
type Broadcast = 'all' | 'self' | 'others' | 'ready';

export class SyncGroup {
  queue: PlayQueue;
  private readonly members = new Map<string, GroupMember>();
  private state: State = { type: 'Idle' };
  private runtimeMs = 0;
  positionMs = 0;
  /** When `positionMs` applies; ahead of now while an unpause is scheduled. */
  lastActivity: number;
  /** When the group stops waiting for members that are not ready. */
  waitDeadline: number | null = null;

  constructor(
    public name: string,
    private readonly send: GroupSend,
    private readonly now: () => number = Date.now,
    readonly id = syncId()
  ) {
    this.queue = new PlayQueue(now);
    this.lastActivity = now();
  }

  /** `items` are the queue's, which `save` leaves out. */
  static restore(
    saved: SavedGroup,
    items: readonly PlaylistItem[],
    send: GroupSend,
    now?: () => number
  ): SyncGroup {
    const group = new SyncGroup(saved.name, send, now, saved.id);
    group.queue = PlayQueue.restore(saved.queue, items, now);
    for (const m of saved.members) group.members.set(m.id, { ...m });
    group.state = { ...saved.state };
    group.runtimeMs = saved.runtimeMs;
    group.positionMs = saved.positionMs;
    group.lastActivity = saved.lastActivity;
    group.waitDeadline = saved.waitDeadline;
    return group;
  }

  save(): SavedGroup {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      members: [...this.members.values()],
      runtimeMs: this.runtimeMs,
      positionMs: this.positionMs,
      lastActivity: this.lastActivity,
      waitDeadline: this.waitDeadline,
      queue: this.queue.save(),
    };
  }

  get stateType(): GroupStateType {
    return this.state.type;
  }

  get size(): number {
    return this.members.size;
  }

  member(id: string): GroupMember | undefined {
    return this.members.get(id);
  }

  memberList(): GroupMember[] {
    return [...this.members.values()];
  }

  info(): GroupInfo {
    return {
      id: this.id,
      name: this.name,
      state: this.state.type,
      participants: [...new Set(this.memberList().map((m) => m.name))],
      lastUpdatedAt: this.now(),
    };
  }

  /** Whether a ping moved enough to store; smaller moves barely shift when unpauses land. */
  pingMoved(id: string, ping: number): boolean {
    const member = this.members.get(id);
    return !!member && Math.abs(clampPing(ping) - member.ping) >= PING_STEP_MS;
  }

  currentPositionMs(): number {
    if (this.state.type !== 'Playing') return this.positionMs;
    return this.positionMs + Math.max(this.now() - this.lastActivity, 0);
  }

  create(creator: GroupMember, playing?: PlayingOnCreate): void {
    this.add(creator);
    this.restartCurrentItem();
    if (
      playing &&
      this.setPlayQueue(playing.items, playing.index, playing.positionMs)
    ) {
      this.state = {
        type: 'Waiting',
        resumePlaying: !playing.paused,
        initial: null,
        positionJumped: false,
      };
    }
    this.to('self', creator.id, { kind: 'joined', info: this.info() });
    this.joined(this.state, creator.id);
  }

  join(member: GroupMember): void {
    this.add(member);
    const self = this.members.get(member.id)!;
    this.to('self', self.id, { kind: 'joined', info: this.info() });
    this.to('others', self.id, { kind: 'user-joined', member: self });
    this.joined(this.state, self.id);
  }

  /** A member that kept its seat came back; unlike a new one, nobody waits for it. */
  rejoin(id: string): void {
    const member = this.members.get(id);
    if (!member) return;
    member.buffering = false;
    member.ignoreWait = false;
    this.to('self', id, { kind: 'joined', info: this.info() });
    const state = this.state;
    if (state.type === 'Idle') return this.command('Stop', 'self', id);
    this.queueUpdate('NewPlaylist', 'self', id);
    if (state.type === 'Waiting' && !this.isBuffering()) {
      // It was the one the group waited for.
      if (state.resumePlaying) {
        this.setState({ type: 'Playing', ignoreBuffering: false });
        return this.playingUnpause('Waiting', id);
      }
      this.setState({ type: 'Paused' });
    }
    this.updateWaitDeadline(false);
    this.to('self', id, {
      kind: 'state',
      state: this.state.type,
      reason: 'IgnoreWait',
    });
    this.command(
      this.state.type === 'Playing' ? 'Unpause' : 'Pause',
      'self',
      id
    );
  }

  leave(id: string): void {
    const member = this.members.get(id);
    if (!member) return;
    this.leaving(this.state, id);
    this.members.delete(id);
    this.updateWaitDeadline(false);
    this.send([id], { kind: 'left' });
    this.to('all', id, { kind: 'user-left', member });
  }

  handle(from: string, request: GroupRequest): void {
    if (!this.members.has(from)) return;
    this.dispatch(this.state, request, this.state.type, from);
  }

  /** Gives up on members still not ready once the wait runs out. */
  tick(): void {
    if (this.waitDeadline === null || this.waitDeadline > this.now()) return;
    this.waitDeadline = null;
    const state = this.state;
    if (state.type !== 'Waiting') return;
    const blocking = this.memberList().find(
      (m) => m.buffering && !m.ignoreWait
    );
    if (!blocking) return;
    if (state.resumePlaying) {
      this.waitingUnpause(state, 'Waiting', blocking.id);
      return;
    }
    this.setAllBuffering(false);
    this.setState({ type: 'Paused' });
    this.command('Pause', 'all', blocking.id);
    this.to('all', blocking.id, {
      kind: 'state',
      state: 'Paused',
      reason: 'Pause',
    });
  }

  private add(member: GroupMember): void {
    if (this.members.has(member.id)) return;
    this.members.set(member.id, {
      ...member,
      ping: DEFAULT_PING_MS,
      buffering: false,
    });
  }

  private recipients(type: Broadcast, from: string): string[] {
    switch (type) {
      case 'self':
        return [from];
      case 'all':
        return [...this.members.keys()];
      case 'others':
        return [...this.members.keys()].filter((id) => id !== from);
      case 'ready':
        return this.memberList()
          .filter((m) => !m.buffering)
          .map((m) => m.id);
    }
  }

  private to(type: Broadcast, from: string, message: GroupMessage): void {
    const to = this.recipients(type, from);
    if (to.length) this.send(to, message);
  }

  private command(
    command: CommandType,
    to: Broadcast,
    from: string,
    when = this.lastActivity
  ): void {
    this.to(to, from, {
      kind: 'command',
      command: {
        playlistItemId: this.queue.playingId(),
        when,
        positionMs: this.positionMs,
        command,
        emittedAt: this.now(),
      },
    });
  }

  private stateUpdate(reason: RequestType, from: string): void {
    this.to('all', from, { kind: 'state', state: this.state.type, reason });
  }

  queueSnapshot(reason: QueueUpdateReason): QueueSnapshot {
    const isPlaying = this.state.type === 'Playing';
    return {
      reason,
      lastUpdate: this.queue.lastChange,
      playlist: [...this.queue.playlist()],
      playingIndex: this.queue.playingIndex,
      startPositionMs: this.currentPositionMs(),
      isPlaying,
      shuffleMode: this.queue.shuffleMode,
      repeatMode: this.queue.repeatMode,
    };
  }

  private queueUpdate(reason: QueueUpdateReason, to: Broadcast, from: string) {
    this.to(to, from, { kind: 'queue', queue: this.queueSnapshot(reason) });
  }

  private setState(state: State): void {
    this.state = state;
    if (state.type !== 'Waiting') this.waitDeadline = null;
  }

  private waiting(): Waiting {
    const state: Waiting = {
      type: 'Waiting',
      resumePlaying: false,
      initial: null,
      positionJumped: false,
    };
    this.setState(state);
    return state;
  }

  /** The state a failed change leaves the group in. */
  private restore(prev: GroupStateType): void {
    // Already waiting, it goes on waiting: members are loading what it set.
    if (prev === 'Waiting') return;
    this.setState(
      prev === 'Playing'
        ? { type: 'Playing', ignoreBuffering: false }
        : prev === 'Paused'
          ? { type: 'Paused' }
          : { type: 'Idle' }
    );
  }

  private sanitize(positionMs: number): number {
    const at = Math.max(positionMs || 0, 0);
    return this.runtimeMs > 0 ? Math.min(at, this.runtimeMs) : at;
  }

  private highestPing(): number {
    let max = -Infinity;
    for (const m of this.members.values()) max = Math.max(max, m.ping);
    return Number.isFinite(max) ? max : DEFAULT_PING_MS;
  }

  private isBuffering(): boolean {
    for (const m of this.members.values())
      if (m.buffering && !m.ignoreWait) return true;
    return false;
  }

  private setBuffering(id: string, buffering: boolean): void {
    const member = this.members.get(id);
    if (member) member.buffering = buffering;
    this.updateWaitDeadline(false);
  }

  private setAllBuffering(buffering: boolean): void {
    for (const m of this.members.values()) m.buffering = buffering;
    this.updateWaitDeadline(buffering);
  }

  private updateWaitDeadline(startNew: boolean): void {
    if (this.state.type !== 'Waiting' || !this.isBuffering()) {
      this.waitDeadline = null;
      return;
    }
    if (this.waitDeadline === null || startNew)
      this.waitDeadline =
        this.now() + (startNew ? LOAD_WAIT_MS : BUFFER_WAIT_MS);
  }

  /** Moves the position on by the play since the last change. */
  private holdPosition(): void {
    const now = this.now();
    this.positionMs += Math.max(now - this.lastActivity, 0);
    this.lastActivity = now;
  }

  private restartCurrentItem(): void {
    this.positionMs = 0;
    this.lastActivity = this.now();
  }

  private setPlayQueue(
    items: QueueItem[],
    index: number,
    startMs: number
  ): boolean {
    if (!items.length || index < 0 || index >= items.length) return false;
    this.queue.reset();
    this.queue.setPlaylist(items);
    this.queue.setPlayingIndex(index);
    this.runtimeMs = this.queue.playing()?.runtimeMs ?? 0;
    this.positionMs = Math.max(startMs, 0);
    this.lastActivity = this.now();
    return true;
  }

  private changedItem(found: boolean): void {
    this.runtimeMs = found ? (this.queue.playing()?.runtimeMs ?? 0) : 0;
    this.restartCurrentItem();
  }

  private startWaiting(state: Waiting, prev: GroupStateType): void {
    if (state.initial === null) state.initial = prev;
  }

  /** A new member waits to be ready; the rest pause meanwhile. */
  private joined(state: State, id: string): void {
    if (state.type === 'Idle') return this.command('Stop', 'self', id);
    const prev = state.type;
    const waiting = state.type === 'Waiting' ? state : this.waiting();
    this.startWaiting(waiting, prev);
    if (prev === 'Playing') {
      waiting.resumePlaying = true;
      this.holdPosition();
    }
    this.queueUpdate('NewPlaylist', 'self', id);
    this.setBuffering(id, true);
    this.command('Pause', 'ready', id);
  }

  private leaving(state: State, id: string): void {
    if (state.type !== 'Waiting') return;
    this.setBuffering(id, false);
    if (this.isBuffering()) return;
    if (state.resumePlaying) {
      this.setState({ type: 'Playing', ignoreBuffering: false });
      this.playingUnpause('Waiting', id);
    } else {
      this.setState({ type: 'Paused' });
    }
  }

  private dispatch(
    state: State,
    request: GroupRequest,
    prev: GroupStateType,
    from: string
  ): void {
    switch (request.type) {
      case 'RemoveFromPlaylist':
        return this.removeFromPlaylist(state, request, from);
      case 'MovePlaylistItem':
        if (this.queue.move(request.playlistItemId, request.newIndex))
          this.queueUpdate('MoveItem', 'all', from);
        return;
      case 'Queue':
        if (!request.items.length) return;
        this.queue.queue(request.items, request.mode);
        return this.queueUpdate(request.mode, 'all', from);
      case 'SetRepeatMode':
        this.queue.setRepeatMode(request.mode);
        return this.queueUpdate('RepeatMode', 'all', from);
      case 'SetShuffleMode':
        this.queue.setShuffleMode(request.mode);
        return this.queueUpdate('ShuffleMode', 'all', from);
      case 'Ping': {
        const member = this.members.get(from);
        if (member) member.ping = clampPing(request.ping);
        return;
      }
    }
    switch (state.type) {
      case 'Idle':
        return this.idle(request, prev, from);
      case 'Paused':
        return this.paused(request, prev, from);
      case 'Playing':
        return this.playing(state, request, prev, from);
      case 'Waiting':
        return this.waitingRequest(state, request, prev, from);
    }
  }

  private toWaiting(request: GroupRequest, from: string): void {
    const prev = this.state.type;
    this.dispatch(this.waiting(), request, prev, from);
  }

  private removeFromPlaylist(
    state: State,
    request: Extract<GroupRequest, { type: 'RemoveFromPlaylist' }>,
    from: string
  ): void {
    let removed: boolean;
    if (request.clearPlaylist) {
      this.queue.clear(request.clearPlayingItem);
      if (request.clearPlayingItem) this.restartCurrentItem();
      removed = request.clearPlayingItem;
    } else {
      removed = this.queue.remove(request.playlistItemIds);
      if (removed) this.changedItem(!!this.queue.playing());
    }
    this.queueUpdate('RemoveItems', 'all', from);
    if (removed && !this.queue.playing()) {
      this.setState({ type: 'Idle' });
      this.stop(state.type, from);
    }
  }

  private stop(prev: GroupStateType, from: string): void {
    this.command('Stop', prev !== 'Idle' ? 'all' : 'self', from);
  }

  private idle(request: GroupRequest, prev: GroupStateType, from: string) {
    switch (request.type) {
      case 'Play':
      case 'Unpause':
      case 'NextItem':
      case 'PreviousItem':
      case 'SetPlaylistItem':
        return this.toWaiting(request, from);
      case 'Pause':
      case 'Stop':
      case 'Seek':
      case 'Buffer':
      case 'Ready':
        return this.stop(prev, from);
      case 'IgnoreWait':
        return this.setIgnoreWait(from, request.ignoreWait);
    }
  }

  private paused(request: GroupRequest, prev: GroupStateType, from: string) {
    switch (request.type) {
      case 'Play':
      case 'Seek':
      case 'Buffer':
      case 'NextItem':
      case 'PreviousItem':
      case 'SetPlaylistItem':
        return this.toWaiting(request, from);
      case 'Unpause':
        this.setState({ type: 'Playing', ignoreBuffering: false });
        return this.playingUnpause(prev, from);
      case 'Pause':
        return this.pausedPause(prev, from);
      case 'Stop':
        this.setState({ type: 'Idle' });
        return this.stop(prev, from);
      case 'Ready':
        return this.pausedReady(prev, from);
      case 'IgnoreWait':
        return this.setIgnoreWait(from, request.ignoreWait);
    }
  }

  private pausedPause(prev: GroupStateType, from: string): void {
    if (prev === 'Paused') return this.command('Pause', 'self', from);
    this.holdPosition();
    this.command('Pause', 'all', from);
    this.stateUpdate('Pause', from);
  }

  private pausedReady(prev: GroupStateType, from: string): void {
    if (prev === 'Paused') return this.command('Pause', 'self', from);
    if (prev === 'Waiting') {
      this.command('Pause', 'all', from);
      this.stateUpdate('Ready', from);
    }
  }

  private playing(
    state: Extract<State, { type: 'Playing' }>,
    request: GroupRequest,
    prev: GroupStateType,
    from: string
  ) {
    switch (request.type) {
      case 'Play':
      case 'Seek':
      case 'NextItem':
      case 'PreviousItem':
      case 'SetPlaylistItem':
        return this.toWaiting(request, from);
      case 'Buffer':
        if (state.ignoreBuffering) return;
        return this.toWaiting(request, from);
      case 'Unpause':
        return this.playingUnpause(prev, from);
      case 'Pause':
        this.setState({ type: 'Paused' });
        return this.pausedPause(prev, from);
      case 'Stop':
        this.setState({ type: 'Idle' });
        return this.stop(prev, from);
      case 'Ready':
        if (prev === 'Playing') return this.command('Unpause', 'self', from);
        if (prev === 'Waiting') this.stateUpdate('Ready', from);
        return;
      case 'IgnoreWait':
        return this.setIgnoreWait(from, request.ignoreWait);
    }
  }

  private playingUnpause(prev: GroupStateType, from: string): void {
    if (prev === 'Playing') return this.command('Unpause', 'self', from);
    // Every member gets the command before the moment it names.
    const delay = Math.max(this.highestPing() * 2, DEFAULT_PING_MS);
    this.lastActivity = this.now() + delay;
    this.command('Unpause', 'all', from);
    this.stateUpdate('Unpause', from);
  }

  private setIgnoreWait(from: string, ignoreWait: boolean): void {
    const member = this.members.get(from);
    if (member) member.ignoreWait = ignoreWait;
    this.updateWaitDeadline(false);
  }

  private waitingRequest(
    state: Waiting,
    request: GroupRequest,
    prev: GroupStateType,
    from: string
  ): void {
    this.startWaiting(state, prev);
    switch (request.type) {
      case 'Play': {
        state.resumePlaying = true;
        const set = this.setPlayQueue(
          request.items,
          request.index,
          request.startMs
        );
        state.positionJumped = set;
        if (!set) return this.restore(prev);
        this.queueUpdate('NewPlaylist', 'all', from);
        return this.setAllBuffering(true);
      }
      case 'SetPlaylistItem': {
        state.resumePlaying = true;
        const found = this.queue.setPlayingById(request.playlistItemId);
        this.changedItem(found);
        state.positionJumped = found;
        if (!found) return this.restore(prev);
        this.queueUpdate('SetCurrentItem', 'all', from);
        return this.setAllBuffering(true);
      }
      case 'Unpause':
        return this.waitingUnpause(state, prev, from);
      case 'Pause':
        state.resumePlaying = false;
        return this.stateUpdate('Pause', from);
      case 'Stop':
        this.setState({ type: 'Idle' });
        return this.stop('Waiting', from);
      case 'Seek':
        if (prev === 'Playing') state.resumePlaying = true;
        else if (prev === 'Paused') state.resumePlaying = false;
        this.positionMs = this.sanitize(request.positionMs);
        this.lastActivity = this.now();
        state.positionJumped = true;
        this.command('Seek', 'all', from);
        this.setAllBuffering(true);
        return this.stateUpdate('Seek', from);
      case 'Buffer':
        return this.waitingBuffer(state, request, prev, from);
      case 'Ready':
        return this.waitingReady(state, request, from);
      case 'NextItem':
      case 'PreviousItem': {
        state.resumePlaying = true;
        // A request for an item no longer playing is a duplicate.
        if (request.playlistItemId !== this.queue.playingId())
          return this.restore(prev);
        const moved =
          request.type === 'NextItem'
            ? this.queue.next()
            : this.queue.previous();
        state.positionJumped = moved;
        if (!moved) return this.restore(prev);
        this.changedItem(true);
        this.queueUpdate(request.type, 'all', from);
        return this.setAllBuffering(true);
      }
      case 'IgnoreWait':
        this.setIgnoreWait(from, request.ignoreWait);
        if (this.isBuffering()) return;
        if (state.resumePlaying) {
          this.setState({ type: 'Playing', ignoreBuffering: false });
          return this.playingUnpause('Waiting', from);
        }
        return this.setState({ type: 'Paused' });
    }
  }

  private waitingUnpause(
    state: Waiting,
    prev: GroupStateType,
    from: string
  ): void {
    if (prev === 'Idle') {
      state.resumePlaying = true;
      this.restartCurrentItem();
      state.positionJumped = true;
      this.queueUpdate('NewPlaylist', 'all', from);
      return this.setAllBuffering(true);
    }
    if (!state.resumePlaying) {
      // It would have paused once ready; now it plays then instead.
      state.resumePlaying = true;
      return this.stateUpdate('Unpause', from);
    }
    // Starts now, without the members that are not ready.
    this.setAllBuffering(false);
    this.setState({ type: 'Playing', ignoreBuffering: true });
    this.playingUnpause('Waiting', from);
  }

  private waitingBuffer(
    state: Waiting,
    request: Extract<GroupRequest, { type: 'Buffer' | 'Ready' }>,
    prev: GroupStateType,
    from: string
  ): void {
    if (request.playlistItemId !== this.queue.playingId()) {
      this.queueUpdate('SetCurrentItem', 'self', from);
      return this.setBuffering(from, true);
    }
    if (prev === 'Playing') {
      state.resumePlaying = true;
      this.setBuffering(from, true);
      this.holdPosition();
      this.command('Pause', 'ready', from);
    } else if (prev === 'Paused') {
      state.resumePlaying = false;
      this.setBuffering(from, true);
      this.command('Pause', 'self', from);
    } else if (prev === 'Waiting') {
      this.setBuffering(from, true);
      if (!state.resumePlaying) this.command('Pause', 'self', from);
    }
    this.stateUpdate('Buffer', from);
  }

  private waitingReady(state: Waiting, request: Report, from: string): void {
    if (request.playlistItemId !== this.queue.playingId()) {
      this.queueUpdate('SetCurrentItem', 'self', from);
      return this.setBuffering(from, true);
    }
    const now = this.now();
    let elapsed = now - request.when;
    // A member whose clock disagrees this much is not timed by it.
    if (Math.abs(elapsed) > TIME_SYNC_OFFSET_MS || !request.isPlaying)
      elapsed = 0;
    const reported = this.sanitize(request.positionMs);
    let delay = this.positionMs - (reported + elapsed);

    if (!state.resumePlaying) {
      if (Math.abs(this.positionMs - reported) > MAX_PLAYBACK_OFFSET_MS) {
        this.setBuffering(from, true);
        this.command('Seek', 'self', from);
        return this.stateUpdate('Ready', from);
      }
      this.setBuffering(from, false);
      if (this.isBuffering()) return;
      this.setState({ type: 'Paused' });
      if (state.initial === 'Playing') this.pausedPause('Waiting', from);
      else if (state.initial === 'Paused') this.pausedReady('Waiting', from);
      return;
    }

    // Without a jump the member is catching up after buffering, and may lag.
    const allowed =
      request.isPlaying && !state.positionJumped
        ? MAX_CATCH_UP_OFFSET_MS
        : MAX_PLAYBACK_OFFSET_MS;
    if (Math.abs(delay) > allowed) {
      this.setBuffering(from, true);
      this.command('Seek', 'self', from);
      return this.stateUpdate('Ready', from);
    }
    this.setBuffering(from, false);
    if (this.isBuffering()) {
      this.command('Pause', 'self', from, now + delay);
      return;
    }
    if (delay > this.highestPing() * 2) {
      // The member that was buffering catches up; the rest resume when it does.
      this.lastActivity = now + delay;
      this.command('Unpause', request.isPlaying ? 'others' : 'all', from);
    } else {
      delay = Math.max(this.highestPing() * 2, DEFAULT_PING_MS);
      this.lastActivity = now + delay;
      this.command('Unpause', 'all', from);
    }
    this.setState({ type: 'Playing', ignoreBuffering: false });
    this.stateUpdate('Ready', from);
  }
}
