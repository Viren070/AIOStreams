import { createLogger } from '../logging/logger.js';
import {
  WatchStateRepository,
  type WatchIdentity,
  type WatchKind,
  type WatchSnapshot,
  type WatchStatePatch,
  type WatchStateRow,
} from '../db/repositories/watch-state.js';
import type {
  WatchChangeListener,
  WatchEvent,
  WatchProgressEvent,
  WatchScope,
  WatchStateProvider,
} from './types.js';

const logger = createLogger('watch-state');

/** Progress at or past this fraction marks the item played. */
const PLAYED_FRACTION = 0.9;
/** Progress below this fraction on stop resets the position. */
const RESUME_MIN_FRACTION = 0.05;
/** Items shorter than this never create a resume entry. */
const RESUME_MIN_DURATION_MS = 90_000;
/** Clients report every 5 to 10 s; the DB sees one write per interval. */
const FLUSH_INTERVAL_MS = 30_000;
const PENDING_MAX = 50_000;

interface PendingProgress {
  scope: WatchScope;
  identity: WatchIdentity;
  positionMs: number;
  durationMs?: number;
  snapshot?: WatchSnapshot;
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
        if (this.pending.size >= PENDING_MAX && !this.pending.has(key)) {
          await this.flush();
        }
        this.pending.set(key, {
          scope,
          identity: event.identity,
          positionMs: event.positionMs ?? 0,
          durationMs: event.durationMs,
          snapshot: event.snapshot,
        });
        this.schedule();
        return null;
      }
      case 'start': {
        this.pending.delete(key);
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
        return this.write(scope, event.identity, {
          favorite: false,
          snapshot: event.snapshot,
        });
    }
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
    }, FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  private progressPatch(p: PendingProgress): WatchStatePatch {
    const dur = p.durationMs ?? 0;
    if (dur > 0 && p.positionMs >= dur * PLAYED_FRACTION) {
      return {
        positionMs: 0,
        durationMs: dur,
        played: true,
        lastPlayedAt: Date.now(),
        snapshot: p.snapshot,
      };
    }
    return {
      positionMs: p.positionMs,
      durationMs: p.durationMs,
      played: false,
      lastPlayedAt: Date.now(),
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
    const pos = event.positionMs ?? existing?.positionMs ?? 0;
    const now = Date.now();
    if (dur > 0 && pos >= dur * PLAYED_FRACTION) {
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
    const tooEarly = dur > 0 && pos < dur * RESUME_MIN_FRACTION;
    return {
      positionMs: tooShort || tooEarly ? 0 : pos,
      durationMs: dur || undefined,
      played: false,
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
    for (const listener of this.listeners) {
      try {
        listener(scope, [row]);
      } catch (error) {
        logger.debug(
          { err: error instanceof Error ? error.message : String(error) },
          'watch-state listener threw'
        );
      }
    }
    return row;
  }
}
