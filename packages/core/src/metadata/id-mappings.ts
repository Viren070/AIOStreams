import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../logging/logger.js';
import { getDataFolder, makeRequest } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { BaseDataset } from '../builtins/base/dataset.js';

const logger = createLogger('id-mappings');

export interface IdSet {
  imdbId?: string;
  tvdbId?: number;
  tmdbId?: number;
}

/**
 * Column store for one media type, sorted by `imdb` so lookups can binary
 * search.
 */
interface TypeMaps {
  imdb: Int32Array;
  tvdb: Int32Array;
  tmdb: Int32Array;
}

/** [imdbNum, tvdbId, tmdbId] as parsed from an upstream CSV; 0 means absent. */
type RawRow = [number, number, number];

/**
 * On-disk format. Holding the processed columns rather than the raw rows keeps
 * conflict detection and sorting on the sync, so a load is a read plus six
 * typed-array views over the same buffer.
 *
 * Bump FORMAT_VERSION whenever the layout or the processing behind it changes:
 * `reloadDataFromFile` then throws and BaseDataset re-syncs.
 *
 *   0  u32 magic
 *   4  u32 version
 *   8  u32 tv row count
 *  12  u32 movie row count
 *  16  f64 lastUpdated
 *  24  tv.imdb, tv.tvdb, tv.tmdb, movie.imdb, movie.tvdb, movie.tmdb
 */
const FORMAT_MAGIC = 0x4d4f4941; // 'AIOM'
const FORMAT_VERSION = 1;
const HEADER_BYTES = 24;
const BYTES_PER_ROW = 12;

const imdbToNum = (imdb: string): number | undefined => {
  const m = /^tt(\d+)$/.exec(imdb.trim());
  return m ? Number(m[1]) : undefined;
};

function emptyTypeMaps(): TypeMaps {
  return {
    imdb: new Int32Array(0),
    tvdb: new Int32Array(0),
    tmdb: new Int32Array(0),
  };
}

/** Index of `key` in the sorted `imdb` column, or -1. */
function findRow(maps: TypeMaps, key: number): number {
  let lo = 0;
  let hi = maps.imdb.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = maps.imdb[mid];
    if (v === key) return mid;
    if (v < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export class IdMappingDataset extends BaseDataset {
  private static instance: IdMappingDataset;
  private tv: TypeMaps = emptyTypeMaps();
  private movie: TypeMaps = emptyTypeMaps();
  protected logger = logger;

  private constructor() {
    super({
      dataPath: path.join(getDataFolder(), 'id-mappings', 'mappings.bin'),
      refreshIntervalSeconds: appConfig.metadata.idMappings.refreshInterval,
      logger,
      taskId: 'id-mappings-refresh',
      taskLabel: 'ID mappings refresh',
      taskDescription:
        'Re-download the cross-provider (imdb/tvdb/tmdb) ID mapping dataset.',
    });
  }

  public static getInstance(): IdMappingDataset {
    if (!IdMappingDataset.instance) {
      IdMappingDataset.instance = new IdMappingDataset();
    }
    return IdMappingDataset.instance;
  }

  /**
   * A tvdb/tmdb id claimed by more than one imdb id is an upstream data error,
   * not a legitimate alias, so the whole group is dropped and the id falls back
   * to the normal per-provider lookup.
   */
  private buildColumns(rows: RawRow[], label: string): TypeMaps {
    const conflicted = { tvdb: new Set<number>(), tmdb: new Set<number>() };
    const claimant = {
      tvdb: new Map<number, number>(),
      tmdb: new Map<number, number>(),
    };
    for (const [imdb, tvdb, tmdb] of rows) {
      if (!imdb) continue;
      for (const [providerId, key] of [
        [tvdb, 'tvdb'],
        [tmdb, 'tmdb'],
      ] as const) {
        if (!providerId) continue;
        const first = claimant[key].get(providerId);
        if (first === undefined) claimant[key].set(providerId, imdb);
        else if (first !== imdb) conflicted[key].add(providerId);
      }
    }

    // Collapse to one row per imdb id, keeping the last non-zero value seen
    // for each provider independently (the previous per-provider `Map.set`
    // order). Then sort by imdb so `findRow` can binary search.
    const merged = new Map<number, [number, number]>();
    for (const [imdb, tvdb, tmdb] of rows) {
      if (!imdb) continue;
      const keepTvdb = tvdb && !conflicted.tvdb.has(tvdb) ? tvdb : 0;
      const keepTmdb = tmdb && !conflicted.tmdb.has(tmdb) ? tmdb : 0;
      if (!keepTvdb && !keepTmdb) continue;
      const existing = merged.get(imdb);
      if (!existing) merged.set(imdb, [keepTvdb, keepTmdb]);
      else {
        if (keepTvdb) existing[0] = keepTvdb;
        if (keepTmdb) existing[1] = keepTmdb;
      }
    }

    const keys = Int32Array.from(merged.keys()).sort();
    const maps: TypeMaps = {
      imdb: keys,
      tvdb: new Int32Array(keys.length),
      tmdb: new Int32Array(keys.length),
    };
    for (let i = 0; i < keys.length; i++) {
      const pair = merged.get(keys[i])!;
      maps.tvdb[i] = pair[0];
      maps.tmdb[i] = pair[1];
    }

    if (conflicted.tvdb.size || conflicted.tmdb.size) {
      logger.debug(
        {
          type: label,
          tvdbIds: conflicted.tvdb.size,
          tmdbIds: conflicted.tmdb.size,
        },
        'dropped id mappings claimed by multiple imdb ids'
      );
    }
    return maps;
  }

  protected async reloadDataFromFile(): Promise<void> {
    const buf = await fs.readFile(this.DATA_PATH);
    if (buf.length < HEADER_BYTES) {
      throw new Error('id mappings cache is truncated');
    }
    if (buf.readUInt32LE(0) !== FORMAT_MAGIC) {
      throw new Error('id mappings cache has an unrecognised header');
    }
    const version = buf.readUInt32LE(4);
    if (version !== FORMAT_VERSION) {
      throw new Error(
        `id mappings cache is format v${version}, expected v${FORMAT_VERSION}`
      );
    }
    const tvCount = buf.readUInt32LE(8);
    const movieCount = buf.readUInt32LE(12);
    const expected = HEADER_BYTES + (tvCount + movieCount) * BYTES_PER_ROW;
    if (buf.length !== expected) {
      throw new Error(
        `id mappings cache is ${buf.length} bytes, expected ${expected}`
      );
    }

    // An Int32Array view needs 4-byte alignment, so copy if readFile's
    // buffer is not.
    const body = buf.subarray(HEADER_BYTES);
    const aligned = (body.byteOffset & 3) === 0 ? body : Buffer.from(body);
    const ints = new Int32Array(
      aligned.buffer,
      aligned.byteOffset,
      (tvCount + movieCount) * 3
    );
    let offset = 0;
    const column = (length: number): Int32Array => {
      const view = ints.subarray(offset, offset + length);
      offset += length;
      return view;
    };
    this.tv = {
      imdb: column(tvCount),
      tvdb: column(tvCount),
      tmdb: column(tvCount),
    };
    this.movie = {
      imdb: column(movieCount),
      tvdb: column(movieCount),
      tmdb: column(movieCount),
    };
    logger.info(
      {
        tvRows: tvCount,
        movieRows: movieCount,
        bytes: buf.length,
        lastUpdated: buf.readDoubleLE(16),
      },
      'loaded id mappings'
    );
  }

  private static encode(tv: TypeMaps, movie: TypeMaps): Buffer {
    const tvCount = tv.imdb.length;
    const movieCount = movie.imdb.length;
    const out = Buffer.allocUnsafe(
      HEADER_BYTES + (tvCount + movieCount) * BYTES_PER_ROW
    );
    out.writeUInt32LE(FORMAT_MAGIC, 0);
    out.writeUInt32LE(FORMAT_VERSION, 4);
    out.writeUInt32LE(tvCount, 8);
    out.writeUInt32LE(movieCount, 12);
    out.writeDoubleLE(Date.now(), 16);
    let offset = HEADER_BYTES;
    for (const column of [
      tv.imdb,
      tv.tvdb,
      tv.tmdb,
      movie.imdb,
      movie.tvdb,
      movie.tmdb,
    ]) {
      Buffer.from(column.buffer, column.byteOffset, column.byteLength).copy(
        out,
        offset
      );
      offset += column.byteLength;
    }
    return out;
  }

  private async fetchCsv(url: string, columns: number): Promise<RawRow[]> {
    const response = await makeRequest(url, {
      method: 'GET',
      timeout: 60000,
      headers: { 'User-Agent': appConfig.http.defaultUserAgent },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    const text = await response.text();
    const rows: RawRow[] = [];
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length < columns) continue;
      const imdb = imdbToNum(parts[0]);
      if (!imdb) continue;
      const tvdb = parts[1] ? Number(parts[1]) : 0;
      const tmdb = parts[2] ? Number(parts[2]) : 0;
      if (!tvdb && !tmdb) continue;
      rows.push([imdb, tvdb || 0, tmdb || 0]);
    }
    return rows;
  }

  protected async performSync(): Promise<void> {
    const cfg = appConfig.metadata.idMappings;
    // Reduced to columns before the next fetch, so both row sets are never
    // live together.
    const tv = this.buildColumns(await this.fetchCsv(cfg.tvUrl, 4), 'tv');
    const movie = this.buildColumns(
      await this.fetchCsv(cfg.movieUrl, 3),
      'movie'
    );

    const tempPath = `${this.DATA_PATH}.tmp`;
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, IdMappingDataset.encode(tv, movie));
    await fs.rename(tempPath, this.DATA_PATH);
    // The JSON cache is no longer read.
    await fs
      .unlink(path.join(path.dirname(this.DATA_PATH), 'mappings.json'))
      .catch(() => undefined);
    logger.info(
      { tv: tv.imdb.length, movie: movie.imdb.length },
      'synced id mappings'
    );
  }

  /**
   * Fill the tvdb/tmdb ids missing from `ids`, anchored on the imdb id.
   * Returns only newly-resolved ids ({} when no imdb id or no match).
   */
  public resolve(mediaType: 'movie' | 'series', ids: IdSet): IdSet {
    const imdbNum = ids.imdbId ? imdbToNum(ids.imdbId) : undefined;
    if (imdbNum === undefined) return {};
    const maps = mediaType === 'movie' ? this.movie : this.tv;
    const row = findRow(maps, imdbNum);
    if (row === -1) return {};
    const out: IdSet = {};
    if (!ids.tvdbId && maps.tvdb[row]) out.tvdbId = maps.tvdb[row];
    if (!ids.tmdbId && maps.tmdb[row]) out.tmdbId = maps.tmdb[row];
    return out;
  }
}
