import { config as appConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import {
  WatchStateRepository,
  type WatchIdentity,
  type WatchKind,
  type WatchSnapshot,
  type WatchStatePatch,
  type WatchStateRow,
} from '../db/repositories/watch-state.js';
import {
  seriesKeyOfMatch,
  type WatchChangeListener,
  type WatchEvent,
  type WatchProgressEvent,
  type WatchScope,
  type WatchStateProvider,
} from './types.js';

const logger = createLogger('watch-state');

/** Items shorter than this never create a resume entry. */
const RESUME_MIN_DURATION_MS = 90_000;

export function playedThrough(
  positionMs: number,
  durationMs: number | undefined
): boolean {
  return (
    !!durationMs &&
    durationMs > 0 &&
    positionMs >= (durationMs * appConfig.watchState.playedPercent) / 100
  );
}

interface PendingProgress {
  scope: WatchScope;
  identity: WatchIdentity;
  positionMs: number;
  durationMs?: number;
  snapshot?: WatchSnapshot;
  /**
   * When the client reported this position, not when it is written.
   *
   * The two differ by a whole flush interval, so the write time would let a
   * buffered tick land after a stop carrying a newer `last_played_at`.
   */
  at: number;
}

export class LocalWatchStateProvider implements WatchStateProvider {
  private readonly pending = new Map<string, PendingProgress>();
  private readonly listeners = new Set<WatchChangeListener>();
  private timer: NodeJS.Timeout | null = null;

  getMany(scope: WatchScope, itemKeys: string[]) {
    return WatchStateRepository.getMany(scope, itemKeys);
  }

  listResume(scope: WatchScope, limit: number, kinds?: WatchKind[]) {
    return WatchStateRepository.listResume(scope, limit, kinds);
  }

  listRecentSeries(scope: WatchScope, limit: number) {
    return WatchStateRepository.listRecentSeries(scope, limit);
  }

  recentSeries(scope: WatchScope, page: number) {
    return WatchStateRepository.recentSeries(scope, page);
  }

  listFavorites(scope: WatchScope, kinds?: WatchKind[]) {
    return WatchStateRepository.listFavorites(scope, kinds);
  }

  listPlayed(scope: WatchScope, kinds?: WatchKind[]) {
    return WatchStateRepository.listPlayed(scope, kinds);
  }

  listForSeries(scope: WatchScope, seriesKey: string) {
    return WatchStateRepository.listForSeries(scope, seriesKey);
  }

  onChange(listener: WatchChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async record(
    scope: WatchScope,
    event: WatchEvent
  ): Promise<WatchStateRow | null> {
    // Per history, or two personas on one episode would share a pending slot.
    const key = `${scope.uuid}|${scope.persona}|${event.identity.itemKey}`;
    switch (event.type) {
      case 'progress': {
        if (
          this.pending.size >= appConfig.watchState.progressBufferMax &&
          !this.pending.has(key)
        ) {
          await this.flush();
        }
        this.pending.set(key, {
          scope,
          identity: event.identity,
          positionMs: event.positionMs ?? 0,
          durationMs: event.durationMs,
          snapshot: event.snapshot,
          at: Date.now(),
        });
        this.schedule();
        return null;
      }
      case 'start': {
        this.pending.delete(key);
        await this.undropOnPlay(scope, event.identity);
        return this.write(scope, event.identity, {
          positionMs: event.positionMs,
          durationMs: event.durationMs,
          lastPlayedAt: Date.now(),
          snapshot: event.snapshot,
        });
      }
      case 'stop': {
        this.pending.delete(key);
        return this.write(
          scope,
          event.identity,
          await this.stopPatch(scope, event)
        );
      }
      case 'played':
        this.pending.delete(key);
        return this.write(scope, event.identity, {
          played: true,
          positionMs: 0,
          incrementPlayCount: 'if-unplayed',
          lastPlayedAt: Date.now(),
          snapshot: event.snapshot,
        });
      case 'unplayed':
        this.pending.delete(key);
        return this.write(scope, event.identity, {
          played: false,
          positionMs: 0,
          snapshot: event.snapshot,
        });
      case 'favorite':
        return this.write(scope, event.identity, {
          favorite: true,
          snapshot: event.snapshot,
        });
      case 'unfavorite':
        await this.unfavoriteSpellings(scope, event.identity);
        return this.write(scope, event.identity, {
          favorite: false,
          snapshot: event.snapshot,
        });
      case 'dropped':
      case 'undropped':
        return this.write(scope, event.identity, {
          dropped: event.type === 'dropped',
          snapshot: event.snapshot,
        });
      case 'rating':
        return this.write(scope, event.identity, {
          rating: event.rating,
          likes: event.likes,
          snapshot: event.snapshot,
        });
    }
  }

  /** Reads count a favourite under any spelling, so every one of them goes. */
  private async unfavoriteSpellings(
    scope: WatchScope,
    identity: WatchIdentity
  ) {
    const keys = [identity.itemKey, identity.matchKey].filter(
      (key): key is string => !!key
    );
    for (const row of await WatchStateRepository.getSpellings(scope, keys)) {
      if (row.favorite && row.itemKey !== identity.itemKey)
        await this.write(scope, row, { favorite: false });
    }
  }

  private async undropOnPlay(scope: WatchScope, identity: WatchIdentity) {
    if (identity.kind !== 'episode' || !identity.seriesKey) return;
    const show = identity.matchKey
      ? seriesKeyOfMatch(identity.matchKey, identity.mediaType)
      : null;
    await WatchStateRepository.undropSeries(
      scope,
      show ? [identity.seriesKey, show] : [identity.seriesKey]
    );
  }

  async clear(scope: WatchScope, itemKeys?: string[]): Promise<number> {
    // Every spelling goes, or the history would list the next one in its place.
    const keys = itemKeys
      ? await WatchStateRepository.withSpellings(scope, itemKeys)
      : undefined;
    const prefix = `${scope.uuid}|${scope.persona}|`;
    const only = keys ? new Set(keys) : null;
    for (const key of this.pending.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (!only || only.has(key.slice(prefix.length))) this.pending.delete(key);
    }
    const cleared = await WatchStateRepository.clearPlayback(scope, keys);
    if (cleared.length) {
      this.notify(
        scope,
        cleared.map((row) => ({
          ...row,
          played: false,
          positionMs: 0,
          playCount: 0,
          lastPlayedAt: null,
        }))
      );
    }
    return cleared.length;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const p of batch) {
      try {
        await this.write(p.scope, p.identity, this.progressPatch(p));
      } catch (error) {
        logger.warn(
          {
            uuid: p.scope.uuid,
            persona: p.scope.persona,
            itemKey: p.identity.itemKey,
            err: error instanceof Error ? error.message : String(error),
          },
          'failed to persist watch progress'
        );
      }
    }
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, appConfig.watchState.progressFlushSeconds * 1000);
    this.timer.unref?.();
  }

  private progressPatch(p: PendingProgress): WatchStatePatch {
    if (playedThrough(p.positionMs, p.durationMs)) {
      return {
        positionMs: 0,
        durationMs: p.durationMs,
        played: true,
        lastPlayedAt: p.at,
        snapshot: p.snapshot,
      };
    }
    /*
     * `played` is absent rather than false, here and on a stop: the upsert
     * coalesces it, so a position on a played item is a rewatch under way.
     * Only an explicit unplayed clears it.
     */
    return {
      positionMs: p.positionMs,
      durationMs: p.durationMs,
      lastPlayedAt: p.at,
      snapshot: p.snapshot,
    };
  }

  private async stopPatch(
    scope: WatchScope,
    event: WatchProgressEvent
  ): Promise<WatchStatePatch> {
    const existing = await WatchStateRepository.get(
      scope,
      event.identity.itemKey
    );
    const dur = event.durationMs || existing?.durationMs || 0;
    const pos = event.positionMs ?? 0;
    const now = Date.now();
    if (playedThrough(pos, dur)) {
      return {
        positionMs: 0,
        durationMs: dur,
        played: true,
        incrementPlayCount: 'if-unplayed',
        lastPlayedAt: now,
        snapshot: event.snapshot,
      };
    }
    const tooShort = dur > 0 && dur < RESUME_MIN_DURATION_MS;
    const tooEarly =
      dur > 0 && pos < (dur * appConfig.watchState.minResumePercent) / 100;
    return {
      positionMs: tooShort || tooEarly ? 0 : pos,
      durationMs: dur || undefined,
      lastPlayedAt: now,
      snapshot: event.snapshot,
    };
  }

  private async write(
    scope: WatchScope,
    identity: WatchIdentity,
    patch: WatchStatePatch
  ): Promise<WatchStateRow> {
    const row = await WatchStateRepository.upsert(scope, identity, patch);
    this.notify(scope, [row]);
    return row;
  }

  private notify(scope: WatchScope, rows: WatchStateRow[]) {
    for (const listener of this.listeners) {
      try {
        listener(scope, rows);
      } catch (error) {
        logger.debug(
          { err: error instanceof Error ? error.message : String(error) },
          'watch-state listener threw'
        );
      }
    }
  }
}
