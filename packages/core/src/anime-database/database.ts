/**
 * Anime database singleton.
 *
 * Owns the merged canonical record list, the per-id-type lookup indexes, and
 * the refresh tasks (one per source, registered with the global TaskManager).
 *
 * Parsed source entries are not retained between rebuilds: memory holds only
 * the merged canonical store and indexes. When a source refreshes, every
 * source file is re-parsed from disk into a new canonical store and atomically
 * swapped in; lookups stay served against the previous store until the swap.
 */
import { config as appConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { TaskManager } from '../tasks/index.js';
import { getTimeTakenSincePoint } from '../utils/time.js';
import { IdParser, type IdType } from '../utils/id-parser.js';
import {
  type AnimeEntry,
  type AnimeRecord,
  type IdValue,
  type SourceEntry,
} from './types.js';
import { ANIME_SOURCES, type AnimeSource } from './sources/index.js';
import { fetchWithEtag, invalidateCache } from './storage/fetcher.js';
import { mergeSources, type SourceBatch } from './merger.js';
import { filterCandidatesBySeasonType, selectBestRecord } from './selector.js';
import { buildAnimeEntry } from './builder.js';

const logger = createLogger('anime-database');

/**
 * Lookup index: idType -> idValue -> record index, or a list of indices on the
 * rare occasions two records share an id. Length-1 postings store a bare number
 * to avoid allocating an array.
 */
type IdPosting = number | number[];
type IdIndex = Map<IdType, Map<IdValue, IdPosting>>;

/**
 * Reduce numeric-string ids (`'123'`) and equivalent numbers (`123`) to one
 * canonical key. Non-numeric strings (slugs etc.) are returned unchanged.
 */
function canonicalIdValue(v: IdValue): IdValue {
  if (typeof v === 'string') {
    if (v === '') return v;
    const n = Number(v);
    if (Number.isInteger(n) && String(n) === v) return n;
  }
  return v;
}

export class AnimeDatabase {
  private static instance: AnimeDatabase | null = null;

  /** Merged canonical records, indexable by `record.rid`. */
  private records: AnimeRecord[] = [];
  /** Per-id-type → idValue (string|number) → record indices into `records`. */
  private indexes: IdIndex = new Map();
  /** Sources whose on-disk cache is current (i.e. downloaded successfully). */
  private readonly availableSources = new Set<string>();
  /** Suppress mid-init rebuilds; flipped on after the first batch load. */
  private allowIncrementalRebuild = false;
  /** In-flight rebuild lock; a second refresh during a rebuild queues one. */
  private rebuildInFlight: Promise<void> | null = null;
  private rebuildQueued = false;
  private isInitialised = false;

  public static getInstance(): AnimeDatabase {
    if (!AnimeDatabase.instance) AnimeDatabase.instance = new AnimeDatabase();
    return AnimeDatabase.instance;
  }

  private constructor() {}

  // ---------------------------------------------------------------------
  // Initialisation + refresh wiring
  // ---------------------------------------------------------------------

  /**
   * Register a TaskManager refresh task per source and run them all once.
   * After every successful refresh the canonical store is re-merged and the
   * id indexes are rebuilt.
   */
  public async initialise(): Promise<void> {
    if (this.isInitialised) {
      logger.warn('already initialised');
      return;
    }

    if (appConfig.metadata.animeDb.levelOfDetail === 'none') {
      logger.info('detail level is none, skipping initialisation');
      this.isInitialised = true;
      return;
    }

    this.registerRefreshTasks();

    logger.info('starting initial refresh of all data sources');
    for (const source of ANIME_SOURCES) {
      const result = await TaskManager.runNow(`anime-db-refresh-${source.id}`);
      if (!result.ok) {
        logger.error(
          { source: source.name, error: result.message },
          'failed to refresh data source'
        );
      }
    }
    // First full rebuild from disk; background refreshes can trigger their
    // own from now on.
    await this.rebuildFromDisk('initial');
    this.allowIncrementalRebuild = true;

    this.isInitialised = true;
    logger.info(
      { records: this.records.length, sources: this.availableSources.size },
      'initialised'
    );
  }

  private registerRefreshTasks(): void {
    for (const source of ANIME_SOURCES) {
      TaskManager.register({
        id: `anime-db-refresh-${source.id}`,
        label: `Refresh ${source.name}`,
        description: `Refresh the ${source.name} anime database source.`,
        category: 'data-sync',
        kind: 'scheduled',
        intervalMs: source.refreshIntervalMs(),
        enabled: true,
        destructive: false,
        multiReplica: 'single',
        run: async () => {
          await this.refreshOneSource(source);
          return { ok: true, message: `${source.name} refreshed` };
        },
      });
      logger.info(
        { source: source.name, intervalMs: source.refreshIntervalMs() },
        'registered auto-refresh task'
      );
    }
  }

  private async refreshOneSource(source: AnimeSource): Promise<void> {
    const start = Date.now();
    const { refreshed } = await fetchWithEtag(
      source.id,
      source.url,
      source.filePath
    );

    // Sanity-parse the cached file to fail fast on corrupt bytes. Entries
    // aren't retained; the upcoming rebuild re-parses them.
    let count = 0;
    try {
      for await (const e of source.parse(source.filePath)) {
        if (e) count++;
      }
    } catch (error) {
      // Cache we didn't just re-download is probably stale/corrupt, so
      // invalidate to force a fresh download next refresh. If a fresh download
      // still failed, the remote data is broken, so keep the cache to avoid
      // looping every tick.
      if (!refreshed) {
        logger.error(
          { source: source.name, error },
          'parse of cached file failed; invalidating'
        );
        await invalidateCache(source.filePath);
      } else {
        logger.error(
          { source: source.name, error },
          'parse of freshly-downloaded file failed; keeping cache'
        );
      }
      this.availableSources.delete(source.id);
      throw error;
    }

    this.availableSources.add(source.id);
    logger.info(
      {
        source: source.name,
        entries: count,
        timeTaken: getTimeTakenSincePoint(start),
      },
      'verified source cache'
    );

    if (this.allowIncrementalRebuild) {
      // Fire-and-forget; rebuilds serialise via `rebuildInFlight`. Errors
      // (including merge/index failures) are caught inside `scheduleRebuild`,
      // so the dropped promise can never reject unhandled.
      void this.scheduleRebuild(source.id);
    }
  }

  /**
   * Ensure exactly one rebuild is running at a time. If a rebuild is already
   * in flight when this is called, a single additional rebuild is queued to
   * run immediately after.
   */
  private scheduleRebuild(reason: string): Promise<void> {
    if (this.rebuildInFlight) {
      this.rebuildQueued = true;
      return this.rebuildInFlight;
    }
    this.rebuildInFlight = (async () => {
      try {
        await this.rebuildFromDisk(reason);
      } catch (error) {
        logger.error({ reason, error }, 'rebuild from disk failed');
      } finally {
        const requeue = this.rebuildQueued;
        this.rebuildQueued = false;
        this.rebuildInFlight = null;
        if (requeue) {
          // Run another pass to absorb whatever triggered the queue.
          await this.scheduleRebuild('coalesced');
        }
      }
    })();
    return this.rebuildInFlight;
  }

  /**
   * Re-parse every available source file from disk, merge into a fresh
   * canonical store, and atomically swap. The previous records / indexes
   * remain serving lookups until the swap completes.
   */
  private async rebuildFromDisk(reason: string): Promise<void> {
    const start = Date.now();
    const batches: SourceBatch[] = [];
    const sourceIdsUsed: string[] = [];
    // Iterate ANIME_SOURCES in registry order so merge precedence is stable.
    for (const source of ANIME_SOURCES) {
      if (!this.availableSources.has(source.id)) continue;
      const entries: SourceEntry[] = [];
      try {
        for await (const e of source.parse(source.filePath)) {
          if (e) entries.push(e);
        }
      } catch (error) {
        logger.error(
          { source: source.name, error },
          'failed to re-parse source during rebuild; skipping'
        );
        continue;
      }
      batches.push({ sourceId: source.id, entries });
      sourceIdsUsed.push(source.id);
    }

    const newRecords = mergeSources(batches);
    const newIndexes = this.buildIndexes(newRecords);

    this.records = newRecords;
    this.indexes = newIndexes;

    logger.info(
      {
        reason,
        records: newRecords.length,
        sources: sourceIdsUsed,
        timeTaken: getTimeTakenSincePoint(start),
      },
      'rebuilt canonical store'
    );
  }

  private buildIndexes(records: AnimeRecord[]): IdIndex {
    const indexes: IdIndex = new Map();
    for (const r of records) {
      for (const [idType, idValue] of Object.entries(r.ids) as Array<
        [IdType, IdValue]
      >) {
        if (idValue === undefined || idValue === null || idValue === '') {
          continue;
        }
        let perType = indexes.get(idType);
        if (!perType) {
          perType = new Map();
          indexes.set(idType, perType);
        }
        // Index under a single canonical form; the lookup path canonicalises
        // the same way, so callers can pass either `'123'` or `123`.
        const key = canonicalIdValue(idValue);
        const existing = perType.get(key);
        if (existing === undefined) {
          // Bare rid for the common length-1 case to avoid an array.
          perType.set(key, r.rid);
        } else if (typeof existing === 'number') {
          if (existing !== r.rid) perType.set(key, [existing, r.rid]);
        } else {
          if (!existing.includes(r.rid)) existing.push(r.rid);
        }
      }
    }
    return indexes;
  }

  // ---------------------------------------------------------------------
  // Public lookup API
  // ---------------------------------------------------------------------

  public isAnime(id: string): boolean {
    const parsedId = IdParser.parse(id, 'unknown');
    if (!parsedId) return false;
    return (
      this.getEntryById(
        parsedId.type,
        parsedId.value,
        parsedId.season ? Number(parsedId.season) : undefined,
        parsedId.episode ? Number(parsedId.episode) : undefined
      ) !== null
    );
  }

  public getEntryById(
    idType: IdType,
    idValue: IdValue,
    season?: number,
    episode?: number
  ): AnimeEntry | null {
    const posting = this.indexes.get(idType)?.get(canonicalIdValue(idValue));
    if (posting === undefined) return null;

    const candidates =
      typeof posting === 'number'
        ? this.records[posting]
          ? [this.records[posting]]
          : []
        : posting.map((rid) => this.records[rid]).filter(Boolean);
    if (candidates.length === 0) return null;
    const filtered = filterCandidatesBySeasonType(candidates, season);
    const chosen = selectBestRecord(filtered, idType, idValue, season, episode);
    if (!chosen) return null;
    return buildAnimeEntry(chosen);
  }
}
