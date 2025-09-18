import { z } from 'zod';
import { Cache, makeRequest, Env, TYPES } from '../utils/index.js';
import { Metadata } from './utils.js';
import { Meta, MetaSchema } from '../db/schemas.js';

const IMDBSuggestionSchema = z.object({
  d: z.array(
    z.object({
      i: z.object({
        height: z.number(),
        imageUrl: z.string(),
        width: z.number(),
      }),
      id: z.string(),
      l: z.string(), // title
      q: z.string(), // 'feature' |
      qid: z.string(), // e.g. 'movie',
      rank: z.number(),
      s: z.string(), // comma separated cast
      y: z.number(), // year
      yr: z.string().optional(),
    })
  ),
  q: z.string(),
  v: z.number(),
});

export class IMDBMetadata {
  private readonly titleCache: Cache<string, Metadata>;
  private readonly cinemetaCache: Cache<string, Meta>;
  private readonly titleCacheTTL = 7 * 24 * 60 * 60;
  private readonly cinemetaCacheTTL = 7 * 24 * 60 * 60;
  private readonly IMDB_SUGGESTION_API =
    'https://v3.sg.media-imdb.com/suggestion/a/';
  private readonly CINEMETA_URL = 'https://v3-cinemeta.strem.io';
  public constructor() {
    this.titleCache = Cache.getInstance('imdb-title');
    this.cinemetaCache = Cache.getInstance('cinemeta');
  }

  public async getTitleAndYear(id: string, type: string): Promise<Metadata> {
    if (!id.startsWith('tt')) {
      throw new Error('IMDB ID must start with "tt"');
    }
    try {
      const imdbSuggestionData = await this.getImdbSuggestionData(id, type);
      return imdbSuggestionData;
    } catch (error) {
      const cinemetaData = await this.getCinemetaData(id, type);
      if (!cinemetaData.name || !cinemetaData.year) {
        throw new Error('Cinemeta data is missing title or year');
      }
      let year = NaN;
      let yearEnd = NaN;

      if (cinemetaData.releaseInfo) {
        const parts = cinemetaData.releaseInfo.toString().split(/[-–—]/);
        const start = parts[0]?.trim();
        const end = parts[1]?.trim();

        if (start) {
          year = Number(start);
        }

        if (end) {
          // Handles 'YYYY-YYYY'
          yearEnd = Number(end);
        } else if (parts.length > 1) {
          // Handles 'YYYY-' (ongoing series)
          yearEnd = new Date().getFullYear();
        }
      }

      // Fallback to cinemetaData.year if parsing releaseInfo fails
      if (isNaN(year) && Number.isInteger(Number(cinemetaData.year))) {
        year = Number(cinemetaData.year);
      }
      return {
        title: cinemetaData.name,
        year,
        yearEnd,
      };
    }
  }

  private async getImdbSuggestionData(
    id: string,
    type: string
  ): Promise<Metadata> {
    const key = `${id}:${type}`;
    const cached = await this.titleCache.get(key);
    if (cached) {
      return cached;
    }

    const url = `${this.IMDB_SUGGESTION_API}${id}.json`;
    const response = await makeRequest(url, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const data = IMDBSuggestionSchema.parse(await response.json());
    const item = data.d.find((item) => item.id === id);
    if (!item) {
      throw new Error(`IMDB item not found for id: ${id}`);
    }
    const title = item.l;
    const year = item.y;
    let yearEnd: number | undefined = undefined;
    const yearString = item.yr;
    if (yearString) {
      const years = yearString.split(/[-–—]/).map((y) => y.trim());
      if (years.length > 1) {
        yearEnd = Number(years[1]);
      }
    }
    this.titleCache.set(key, { title, year, yearEnd }, this.titleCacheTTL);
    return { title, year, yearEnd };
  }

  public async getCinemetaData(id: string, type: string) {
    const url = `${this.CINEMETA_URL}/meta/${type}/${id}.json`;
    const cached = await this.cinemetaCache.get(url);
    if (cached) {
      return cached;
    }
    const response = await makeRequest(url, {
      timeout: 2000,
    });
    const meta = MetaSchema.parse(((await response.json()) as any).meta);
    this.cinemetaCache.set(url, meta, this.cinemetaCacheTTL);
    return meta;
  }
}
