import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { createLogger } from '../logging/logger.js';
import { getDataFolder, HEADER_PRESETS, makeRequest } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { BaseDataset } from '../builtins/base/dataset.js';

const logger = createLogger('scene-mappings');

// Sonarr scene-mapping list entry. filterRegex/sceneSeasonNumber are ignored:
// exact air-date matching already disambiguates the collisions they solve.
const SceneMappingEntrySchema = z.looseObject({
  tvdbId: z.number(),
  title: z.string().nullable().optional(),
  searchTitle: z.string().nullable().optional(),
  season: z.number().nullable().optional(),
});

interface SceneMappingEntry {
  title?: string;
  searchTitle?: string;
  /** -1 applies to all seasons. */
  season: number;
}

interface SceneMappingData {
  byTvdbId: Record<string, SceneMappingEntry[]>;
  lastUpdated: number;
}

const normalise = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]/g, '');

export class SceneMappingDataset extends BaseDataset {
  private static instance: SceneMappingDataset;
  private byTvdbId = new Map<number, SceneMappingEntry[]>();
  protected logger = logger;

  private constructor() {
    super({
      dataPath: path.join(getDataFolder(), 'scene-mappings', 'mappings.json'),
      refreshIntervalSeconds: appConfig.metadata.sceneMappings.refreshInterval,
      logger,
      taskId: 'scene-mappings-refresh',
      taskLabel: 'Scene mappings refresh',
      taskDescription:
        'Re-download the scene title mapping list used for search queries and title matching.',
    });
  }

  public static getInstance(): SceneMappingDataset {
    if (!SceneMappingDataset.instance) {
      SceneMappingDataset.instance = new SceneMappingDataset();
    }
    return SceneMappingDataset.instance;
  }

  protected async reloadDataFromFile(): Promise<void> {
    const fileContent = await fs.readFile(this.DATA_PATH, 'utf-8');
    const data: SceneMappingData = JSON.parse(fileContent);
    const map = new Map<number, SceneMappingEntry[]>();
    for (const [tvdbId, entries] of Object.entries(data.byTvdbId)) {
      map.set(Number(tvdbId), entries);
    }
    this.byTvdbId = map;
    logger.info({ series: map.size }, 'loaded scene mappings');
  }

  protected async performSync(): Promise<void> {
    const response = await makeRequest(appConfig.metadata.sceneMappings.url, {
      method: 'GET',
      timeout: 30000,
      headers: {
        'User-Agent': HEADER_PRESETS.sonarr['User-Agent'],
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch scene mappings: ${response.status} ${response.statusText}`
      );
    }
    const json = await response.json();
    if (!Array.isArray(json)) {
      throw new Error('Scene mapping list is not an array');
    }

    const byTvdbId: Record<string, SceneMappingEntry[]> = {};
    let skipped = 0;
    for (const raw of json) {
      const parsed = SceneMappingEntrySchema.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      const { tvdbId, title, searchTitle, season } = parsed.data;
      if (!title && !searchTitle) {
        skipped++;
        continue;
      }
      (byTvdbId[tvdbId] ??= []).push({
        title: title ?? undefined,
        searchTitle: searchTitle ?? undefined,
        season: season ?? -1,
      });
    }

    const data: SceneMappingData = { byTvdbId, lastUpdated: Date.now() };
    const tempPath = `${this.DATA_PATH}.tmp`;
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(data));
    await fs.rename(tempPath, this.DATA_PATH);
    logger.info(
      {
        entries: json.length - skipped,
        skipped,
        series: Object.keys(byTvdbId).length,
      },
      'synced scene mappings'
    );
  }

  /**
   * Search titles for a series, deduplicated, with aliases that differ from
   * the canonical title (after normalisation) ordered first.
   */
  public getSearchTitles(
    tvdbId: number,
    options?: {
      /** Seasons the request may refer to; season-scoped aliases outside these are dropped. */
      seasons?: (number | undefined)[];
      canonicalTitle?: string;
    }
  ): string[] {
    const entries = this.byTvdbId.get(tvdbId);
    if (!entries?.length) {
      return [];
    }
    const seasons = options?.seasons?.filter(
      (s): s is number => s !== undefined
    );
    const canonical = options?.canonicalTitle
      ? normalise(options.canonicalTitle)
      : undefined;

    const seen = new Set<string>();
    const identity: string[] = [];
    const aliases: string[] = [];
    for (const entry of entries) {
      if (entry.season !== -1 && seasons?.length) {
        if (!seasons.includes(entry.season)) continue;
      }
      for (const title of [entry.searchTitle, entry.title]) {
        if (!title) continue;
        const key = normalise(title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        (key === canonical ? identity : aliases).push(title);
      }
    }
    return [...aliases, ...identity];
  }
}
