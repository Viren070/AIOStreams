/**
 * Anime database singleton.
 *
 * Owns the refresh tasks (one per source, registered with the global
 * TaskManager) and the rebuild pipeline. The merged canonical store lives in
 * SQL; only a small lookup cache is held in memory.
 */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import { config as appConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { TaskManager } from '../tasks/index.js';
import { getTimeTakenSincePoint } from '../utils/time.js';
import { IdParser, type IdType } from '../utils/id-parser.js';
import { AnimeRepository } from '../db/repositories/anime.js';
import {
  canonicalIdValue,
  type AnimeEntry,
  type IdValue,
  type SourceEntry,
} from './types.js';
import { ANIME_SOURCES, type AnimeSource } from './sources/index.js';
import {
  fetchWithEtag,
  invalidateCache,
  readCachedEtag,
} from './storage/fetcher.js';
import { mergeSources, type SourceBatch } from './merger.js';
import { filterCandidatesBySeasonType, selectBestRecord } from './selector.js';
import { buildAnimeEntry } from './builder.js';

const logger = createLogger('anime-database');

/**
 * Several subsystems resolve the same parsed id within one request, so a small
 * cache absorbs the repeats.
 */
const CACHE_MAX_ENTRIES = 64;

export class AnimeDatabase {
  private static instance: AnimeDatabase | null = null;

  /** Sources whose on-disk cache is current (i.e. downloaded successfully). */
  private readonly availableSources = new Set<string>();
  /** Sources whose cache file was re-downloaded by their latest refresh. */
  private readonly freshlyDownloaded = new Set<string>();
  /** Suppress mid-init rebuilds; flipped on after the first batch load. */
  private allowIncrementalRebuild = false;
  /** In-flight rebuild lock; a second refresh during a rebuild queues one. */
  private rebuildInFlight: Promise<void> | null = null;
  private rebuildQueued = false;
  private isInitialised = false;
  /** Set when the detail level is `none`; every lookup then resolves to null. */
  private disabled = false;
  /** LRU over resolved entries, cleared whenever the store is replaced. */
  private readonly cache = new Map<string, AnimeEntry | null>();

  public static getInstance(): AnimeDatabase {
    if (!AnimeDatabase.instance) AnimeDatabase.instance = new AnimeDatabase();
    return AnimeDatabase.instance;
  }

  private constructor() {}

  // ---------------------------------------------------------------------
  // Initialisation + refresh wiring
  // ---------------------------------------------------------------------

  /**
   * Register a refresh task per source and run them all once, then rebuild
   * only if the sources the store was built from have changed.
   */
  public async initialise(): Promise<void> {
    if (this.isInitialised) {
      logger.warn('already initialised');
      return;
    }

    if (appConfig.metadata.animeDb.levelOfDetail === 'none') {
      logger.info('detail level is none, skipping initialisation');
      this.disabled = true;
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

    const fingerprint = await this.computeFingerprint();
    const stored = await AnimeRepository.readBuild();
    if (stored && stored.records > 0 && stored.fingerprint === fingerprint) {
      logger.info(
        { records: stored.records, sources: this.availableSources.size },
        'stored store matches the current sources, skipping rebuild'
      );
    } else {
      await this.rebuildFromDisk(stored ? 'sources changed' : 'initial');
    }
    this.allowIncrementalRebuild = true;
    this.isInitialised = true;
  }

  /**
   * Identity of the data the store was built from. The ETag is the real
   * signal; file size covers the rare source that serves none.
   *
   * A parsing change with no source change is not covered: run the
   * `anime-db-rebuild` task, or wait for the next refresh.
   */
  private async computeFingerprint(): Promise<string> {
    const parts: string[] = [];
    for (const source of ANIME_SOURCES) {
      if (!this.availableSources.has(source.id)) continue;
      const etag = await readCachedEtag(source.filePath);
      const size = await fs
        .stat(source.filePath)
        .then((s) => s.size)
        .catch(() => -1);
      parts.push(`${source.id}|${source.url}|${etag ?? ''}|${size}`);
    }
    return createHash('sha1').update(parts.join('\n')).digest('hex');
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
        // The store is shared, so one replica rebuilding it is enough.
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
    TaskManager.register({
      id: 'anime-db-rebuild',
      label: 'Rebuild anime database',
      description:
        'Re-parse every cached source file and replace the stored anime ' +
        'database. Use after a parsing change, which no source refresh would ' +
        'otherwise announce.',
      category: 'data-sync',
      kind: 'manual',
      enabled: true,
      destructive: false,
      multiReplica: 'single',
      run: async () => {
        await this.scheduleRebuild('manual');
        return { ok: true, message: 'anime database rebuilt' };
      },
    });
  }

  private async refreshOneSource(source: AnimeSource): Promise<void> {
    const { refreshed } = await fetchWithEtag(
      source.id,
      source.url,
      source.filePath
    );
    if (refreshed) this.freshlyDownloaded.add(source.id);

    this.availableSources.add(source.id);

    if (this.allowIncrementalRebuild) {
      // Fire-and-forget; rebuilds serialise via `rebuildInFlight`. Errors
      // (including merge/write failures) are caught inside `scheduleRebuild`,
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
   * canonical store, and write it.
   */
  private async rebuildFromDisk(reason: string): Promise<void> {
    const start = Date.now();
    const batches: SourceBatch[] = [];
    const entryCounts: Record<string, number> = {};
    // Iterate ANIME_SOURCES in registry order so merge precedence is stable.
    for (const source of ANIME_SOURCES) {
      if (!this.availableSources.has(source.id)) continue;
      const entries: SourceEntry[] = [];
      try {
        for await (const e of source.parse(source.filePath)) {
          if (e) entries.push(e);
        }
      } catch (error) {
        const fresh = this.freshlyDownloaded.has(source.id);
        logger.error(
          { source: source.name, error },
          fresh
            ? 'parse of freshly-downloaded file failed; keeping cache'
            : 'parse of cached file failed; invalidating'
        );
        if (!fresh) await invalidateCache(source.filePath);
        this.availableSources.delete(source.id);
        continue;
      }
      this.freshlyDownloaded.delete(source.id);
      batches.push({ sourceId: source.id, entries });
      entryCounts[source.id] = entries.length;
    }

    const records = mergeSources(batches);
    // After parsing, so a source dropped for a parse failure is excluded.
    const fingerprint = await this.computeFingerprint();
    await AnimeRepository.replaceAll(records, fingerprint);
    this.cache.clear();

    logger.info(
      {
        reason,
        records: records.length,
        sources: entryCounts,
        timeTaken: getTimeTakenSincePoint(start),
      },
      'rebuilt canonical store'
    );
  }

  // ---------------------------------------------------------------------
  // Public lookup API
  // ---------------------------------------------------------------------

  /** The entry `id` resolves to, if any. */
  public async resolve(id: string): Promise<AnimeEntry | null> {
    const parsedId = IdParser.parse(id, 'unknown');
    if (!parsedId) return null;
    return this.getEntryById(
      parsedId.type,
      parsedId.value,
      parsedId.season ? Number(parsedId.season) : undefined,
      parsedId.episode ? Number(parsedId.episode) : undefined
    );
  }

  public async isAnime(id: string): Promise<boolean> {
    return (await this.resolve(id)) !== null;
  }

  public async getEntryById(
    idType: IdType,
    idValue: IdValue,
    season?: number,
    episode?: number
  ): Promise<AnimeEntry | null> {
    if (this.disabled) return null;
    const key = `${idType}:${canonicalIdValue(idValue)}:${season ?? ''}:${episode ?? ''}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Re-insert so the hot set survives eviction.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const candidates = await AnimeRepository.findCandidates(idType, idValue);
    let entry: AnimeEntry | null = null;
    if (candidates.length > 0) {
      const filtered = filterCandidatesBySeasonType(candidates, season);
      const chosen = selectBestRecord(
        filtered,
        idType,
        idValue,
        season,
        episode
      );
      if (chosen) entry = buildAnimeEntry(chosen);
    }

    this.cache.set(key, entry);
    if (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    return entry;
  }
}
