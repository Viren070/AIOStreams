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
import {
  AnimeRepository,
  decidePublish,
  type AnimeBuildInfo,
  type PublishOutcome,
} from '../db/repositories/anime.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import {
  canonicalIdValue,
  type AnimeEntry,
  type IdValue,
  type SourceEntry,
} from './types.js';
import { ANIME_SOURCES, type AnimeSource } from './sources/index.js';
import { ANIME_DATABASE_PATH } from './storage/paths.js';
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

/** How long a replica waits for another to finish downloading a source. */
const SOURCE_LOCK_MS = 5 * 60 * 1000;

const ALL_SOURCE_IDS = ANIME_SOURCES.map((source) => source.id);

const PUBLISH_MESSAGE: Record<PublishOutcome, string> = {
  published: 'published the rebuilt store',
  unchanged: 'store was already current, discarded this build',
  superseded:
    'stored store has sources this replica is missing, discarded this build',
};

export class AnimeDatabase {
  private static instance: AnimeDatabase | null = null;

  /**
   * Per source, the file version a parse failure has already spent a
   * re-download on. Cleared once that source parses.
   */
  private readonly retriedVersions = new Map<string, string | null>();
  /** Suppress mid-init syncs; flipped on once the initial one has run. */
  private allowIncrementalSync = false;
  /** In-flight sync; a refresh landing during one queues a single follow-up. */
  private syncInFlight: Promise<void> | null = null;
  private queuedSync: { force: boolean } | null = null;
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
   * Register a refresh task per source, run them all once, then bring the
   * shared store in line with whatever landed on disk.
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

    // Through `scheduleSync`, so a failure here still leaves the replica able
    // to rebuild on its next refresh.
    await this.scheduleSync('initial');
    this.allowIncrementalSync = true;
    this.isInitialised = true;
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
        multiReplica: 'all',
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
        await this.scheduleSync('manual', true);
        return { ok: true, message: 'anime database rebuilt' };
      },
    });
  }

  private async refreshOneSource(source: AnimeSource): Promise<void> {
    // Lives beside the files it protects, so it only serialises replicas that
    // share a data volume.
    await DistributedLock.getInstance().withLock(
      `anime-source-${source.id}`,
      () => fetchWithEtag(source.id, source.url, source.filePath),
      {
        type: 'file',
        lockDir: ANIME_DATABASE_PATH,
        timeout: SOURCE_LOCK_MS,
        ttl: SOURCE_LOCK_MS,
      }
    );

    if (this.allowIncrementalSync) {
      // Fire-and-forget; syncs serialise via `syncInFlight`, and errors are
      // caught inside `scheduleSync`, so the dropped promise cannot reject.
      void this.scheduleSync(source.id);
    }
  }

  // ---------------------------------------------------------------------
  // Rebuilding the shared store
  // ---------------------------------------------------------------------

  /**
   * Ensure exactly one sync runs at a time on this replica. If one is already
   * in flight, a single follow-up is queued to absorb whatever triggered it.
   */
  private scheduleSync(reason: string, force = false): Promise<void> {
    if (this.syncInFlight) {
      this.queuedSync = { force: force || (this.queuedSync?.force ?? false) };
      return this.syncInFlight;
    }
    this.syncInFlight = (async () => {
      try {
        await this.syncStore(reason, force);
      } catch (error) {
        logger.error({ reason, error }, 'failed to sync the anime store');
      } finally {
        const queued = this.queuedSync;
        this.queuedSync = null;
        this.syncInFlight = null;
        if (queued) await this.scheduleSync('coalesced', queued.force);
      }
    })();
    return this.syncInFlight;
  }

  /**
   * Bring the shared store in line with this replica's source files.
   *
   * Every replica runs this, and nothing coordinates them: {@link currentBuild}
   * keeps a replica from parsing what the store already holds, and
   * `AnimeRepository.publish` settles whoever still writes at the same time.
   */
  private async syncStore(reason: string, force = false): Promise<void> {
    const onDisk = await this.sourcesOnDisk();

    if (!force) {
      const current = await this.currentBuild(onDisk);
      if (current) {
        logger.info(
          { reason, records: current.records, sources: current.sources.length },
          'stored store already covers this replica, skipping rebuild'
        );
        return;
      }
    }

    const start = Date.now();
    const built: AnimeSource[] = [];
    const batches: SourceBatch[] = [];
    const entryCounts: Record<string, number> = {};
    // `onDisk` follows registry order, so merge precedence is stable.
    for (const source of onDisk) {
      const entries: SourceEntry[] = [];
      try {
        for await (const e of source.parse(source.filePath)) {
          if (e) entries.push(e);
        }
      } catch (error) {
        // Dropping the cache is worth one attempt per version of the file. A
        // fresh copy of a version that already failed will fail the same way,
        // so from the second failure on, the parser is the suspect.
        const version = await readCachedEtag(source.filePath);
        const retried = this.retriedVersions.get(source.id) === version;
        logger.error(
          { source: source.name, error },
          retried
            ? 'parse failed again on the same file version; keeping cache'
            : 'parse of cached file failed; invalidating'
        );
        if (!retried) {
          this.retriedVersions.set(source.id, version);
          await invalidateCache(source.filePath);
        }
        continue;
      }
      this.retriedVersions.delete(source.id);
      built.push(source);
      batches.push({ sourceId: source.id, entries });
      entryCounts[source.id] = entries.length;
    }

    const records = mergeSources(batches);
    const outcome = await AnimeRepository.publish({
      records,
      // Over `built`, not `onDisk`: a source that failed to parse is not in
      // this build and must not be claimed as part of it.
      fingerprint: await this.fingerprint(built),
      sources: built.map((source) => source.id),
      allSources: ALL_SOURCE_IDS,
      force,
    });
    if (outcome === 'published') this.cache.clear();

    logger.info(
      {
        reason,
        records: records.length,
        sources: entryCounts,
        timeTaken: getTimeTakenSincePoint(start),
      },
      PUBLISH_MESSAGE[outcome]
    );
  }

  /**
   * The stored build, when building here would only produce something
   * `publish` would discard. Whoever publishes a fingerprint first spares
   * every replica reaching this later the parse.
   */
  private async currentBuild(
    onDisk: readonly AnimeSource[]
  ): Promise<AnimeBuildInfo | null> {
    const stored = await AnimeRepository.readBuild();
    const outcome = decidePublish(stored, {
      fingerprint: await this.fingerprint(onDisk),
      sources: onDisk.map((source) => source.id),
      allSources: ALL_SOURCE_IDS,
    });
    return outcome === 'published' ? null : stored;
  }

  /** Registered sources whose cache file is on disk, in registry order. */
  private async sourcesOnDisk(): Promise<AnimeSource[]> {
    const present = await Promise.all(
      ANIME_SOURCES.map((source) =>
        fs
          .access(source.filePath)
          .then(() => true)
          .catch(() => false)
      )
    );
    return ANIME_SOURCES.filter((_, i) => present[i]);
  }

  /**
   * Identity of the data a build was made from. The ETag is the real signal;
   * file size covers the rare source that serves none.
   *
   * A parsing change with no source change is not covered: run the
   * `anime-db-rebuild` task, or wait for the next refresh.
   */
  private async fingerprint(sources: readonly AnimeSource[]): Promise<string> {
    const parts: string[] = [];
    for (const source of sources) {
      const etag = await readCachedEtag(source.filePath);
      const size = await fs
        .stat(source.filePath)
        .then((st) => st.size)
        .catch(() => -1);
      parts.push(`${source.id}|${source.url}|${etag ?? ''}|${size}`);
    }
    return createHash('sha1').update(parts.join('\n')).digest('hex');
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

  public async hasSiblingRecords(
    idType: IdType,
    idValue: IdValue
  ): Promise<boolean> {
    if (this.disabled) return false;
    const candidates = await AnimeRepository.findCandidates(idType, idValue);
    return candidates.length > 1;
  }
}
