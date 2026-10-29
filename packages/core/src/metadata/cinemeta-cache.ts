import type { Meta } from '../db/schemas.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export interface CinemetaEntry {
  meta?: Meta;
  fetchedAt?: number;
  refreshAt: number;
  freshUntil: number;
  staleUntil: number;
  errorUntil: number;
  failures: number;
  retryAt: number;
}

export interface CinemetaStore {
  get(key: string): Promise<CinemetaEntry | undefined>;
  set(
    key: string,
    entry: CinemetaEntry,
    ttl: number,
    forceWrite?: boolean
  ): Promise<void>;
}

export interface CinemetaEpisode {
  season?: string;
  episode?: string;
}

/** Unknown series are refreshed like ongoing ones, never assumed complete. */
export function cinemetaPolicy(meta: Meta, type: string, now: number) {
  const futureVideo = meta.videos?.some(
    (v) => v.released && Date.parse(v.released) > now
  );
  const range = String(meta.releaseInfo ?? '').match(
    /^(\d{4})\s*[-–—]\s*(\d{4})$/
  );
  const status = String(meta.status ?? '').trim();
  const explicitlyOngoing =
    /^(returning series|in production|planned|pilot|ongoing|continuing)$/i.test(
      status
    );
  const ended =
    /^(ended|canceled|cancelled)$/i.test(status) ||
    (!explicitlyOngoing &&
      !!range &&
      Number(range[2]) >= Number(range[1]) &&
      Number(range[2]) <= new Date(now).getUTCFullYear());
  const ongoing =
    type !== 'movie' &&
    (!ended ||
      futureVideo ||
      meta.behaviorHints?.hasScheduledVideo ||
      meta.behaviorHints?.hasScheduledVideos);
  return ongoing
    ? { refresh: 45 * 60_000, fresh: HOUR, stale: DAY, error: 7 * DAY }
    : { refresh: 6 * DAY, fresh: 7 * DAY, stale: 14 * DAY, error: 30 * DAY };
}

/**
 * A raw, show-scoped cache. A background completion only changes future reads;
 * callers receive copies so an active request keeps one consistent snapshot.
 * The store is the existing SQL Cache, independent of Redis persistence.
 */
export class CinemetaCache {
  private inFlight = new Map<string, Promise<Meta>>();
  private reads = new Map<string, Promise<CinemetaEntry | undefined>>();
  private background = 0;

  constructor(
    private readonly options: {
      store: CinemetaStore;
      load: (id: string, type: string) => Promise<Meta>;
      now?: () => number;
      maxBackground?: number;
      onError?: (error: unknown) => void;
    }
  ) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }

  private read(key: string): Promise<CinemetaEntry | undefined> {
    const pending = this.reads.get(key);
    if (pending) return pending;
    const read = this.options.store
      .get(key)
      .catch((error) => {
        this.options.onError?.(error);
        return undefined;
      })
      .finally(() => this.reads.delete(key));
    this.reads.set(key, read);
    return read;
  }

  private async persist(key: string, entry: CinemetaEntry, ttl: number) {
    // Persistence is best effort, just like the underlying SQL cache. A disk
    // failure must not discard a successful provider response or mark it bad.
    try {
      await this.options.store.set(key, entry, ttl, true);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private usable(
    meta: Meta | undefined,
    request: CinemetaEpisode,
    stale: boolean
  ): meta is Meta {
    if (!meta) return false;
    if (request.season === undefined || request.episode === undefined)
      return true;
    const video = meta.videos?.find(
      (v) =>
        v.season === Number(request.season) &&
        (v.episode ?? v.number) === Number(request.episode)
    );
    // Never let stale data supply guessed numbering for an absent/future episode.
    return (
      !!video &&
      (!stale || (!!video.released && Date.parse(video.released) <= this.now()))
    );
  }

  async get(
    id: string,
    type: string,
    request: CinemetaEpisode = {}
  ): Promise<Meta> {
    const key = `${type}:${id}`; // deliberately excludes season and episode
    const entry = await this.read(key);
    const now = this.now();
    if (
      entry?.meta &&
      (this.usable(entry.meta, request, false) ||
        // A fresh response can legitimately omit an episode in a foreign
        // numbering scheme. Avoid refetching that same response on every
        // request, while checking again promptly for newly added episodes.
        (entry.fetchedAt !== undefined && now < entry.fetchedAt + 60_000)) &&
      now < entry.freshUntil
    ) {
      if (now >= entry.refreshAt)
        this.refreshInBackground(key, id, type, entry);
      return structuredClone(entry.meta);
    }
    if (
      entry?.meta &&
      this.usable(entry.meta, request, true) &&
      now < entry.staleUntil
    ) {
      this.refreshInBackground(key, id, type, entry);
      return structuredClone(entry.meta);
    }
    if (entry && now < entry.retryAt) {
      if (this.usable(entry.meta, request, true) && now < entry.errorUntil) {
        return structuredClone(entry.meta);
      }
      throw new Error('Cinemeta temporarily unavailable (retry backoff)');
    }
    try {
      return structuredClone(await this.refresh(key, id, type, entry));
    } catch (error) {
      if (
        entry &&
        this.usable(entry.meta, request, true) &&
        this.now() < entry.errorUntil
      ) {
        return structuredClone(entry.meta);
      }
      throw error; // MetadataService can still merge other successful providers.
    }
  }

  private refreshInBackground(
    key: string,
    id: string,
    type: string,
    entry: CinemetaEntry
  ) {
    if (
      this.now() < entry.retryAt ||
      this.inFlight.has(key) ||
      this.background >= (this.options.maxBackground ?? 4)
    )
      return;
    this.background++;
    void this.refresh(key, id, type, entry)
      .catch((error) => this.options.onError?.(error))
      .finally(() => {
        this.background--;
      });
  }

  private refresh(
    key: string,
    id: string,
    type: string,
    previous?: CinemetaEntry
  ): Promise<Meta> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = (async () => {
      // A caller's SQL read may have started before another refresh committed.
      // Recheck under single-flight before allowing that old snapshot to
      // overwrite a newer success or persisted retry state.
      const latest = await this.read(key);
      if (latest) {
        if (
          latest.meta &&
          latest.freshUntil > (previous?.freshUntil ?? 0) &&
          this.now() < latest.freshUntil
        )
          return latest.meta;
        previous = latest;
        if (this.now() < latest.retryAt)
          throw new Error('Cinemeta temporarily unavailable (retry backoff)');
      }
      try {
        const meta = await this.options.load(id, type);
        const now = this.now();
        const policy = cinemetaPolicy(meta, type, now);
        const entry: CinemetaEntry = {
          meta,
          fetchedAt: now,
          refreshAt: now + policy.refresh,
          freshUntil: now + policy.fresh,
          staleUntil: now + policy.stale,
          errorUntil: now + policy.error,
          failures: 0,
          retryAt: 0,
        };
        // Write through before resolving cold loads so a restart cannot lose a
        // successful fetch sitting in the SQL cache's normal write buffer.
        await this.persist(key, entry, Math.ceil(policy.error / 1000));
        return meta;
      } catch (error) {
        const now = this.now();
        const failures = Math.min((previous?.failures ?? 0) + 1, 10);
        const retryAt = now + Math.min(60_000 * 2 ** (failures - 1), HOUR);
        const entry: CinemetaEntry = {
          refreshAt: 0,
          freshUntil: 0,
          staleUntil: 0,
          errorUntil: 0,
          ...previous,
          failures,
          retryAt,
        };
        // Failure never moves last-good freshness/staleness deadlines forward.
        await this.persist(
          key,
          entry,
          Math.max(
            1,
            Math.ceil((Math.max(entry.errorUntil, retryAt) - now) / 1000)
          )
        );
        throw error;
      }
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}
