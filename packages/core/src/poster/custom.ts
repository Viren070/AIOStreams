import { BasePosterService } from './base.js';
import { IdParser, type IdType } from '../utils/id-parser.js';
import { AnimeDatabase } from '../anime-database/index.js';
import { IdMappingDataset } from '../metadata/id-mappings.js';

/** Placeholder → the ID type that fills it. */
const ID_PLACEHOLDERS: Record<string, IdType> = {
  imdb_id: 'imdbId',
  tmdb_id: 'themoviedbId',
  tvdb_id: 'thetvdbId',
  mal_id: 'malId',
  kitsu_id: 'kitsuId',
  anilist_id: 'anilistId',
  anidb_id: 'anidbId',
};

const KNOWN_PLACEHOLDERS = new Set([
  ...Object.keys(ID_PLACEHOLDERS),
  'id',
  'type',
  'shape',
]);

/** `{a}`, `{a|b}` (first available), `{a?}` (blank instead of skipping the URL). */
const PLACEHOLDER_REGEX = /\{([a-z_]+(?:\|[a-z_]+)*)(\?)?\}/g;

/**
 * Poster URL filled in from a user-supplied pattern. The pattern doubles as
 * the API key, so cache keys and redirect URLs carry it.
 */
export class CustomPoster extends BasePosterService {
  readonly serviceName = 'Custom Poster URL';
  readonly ownDomains: string[];
  readonly redirectPathSegment = 'custom';

  constructor(template: string) {
    super(template, 'customPoster');
    try {
      this.ownDomains = [new URL(this.withDummyValues()).hostname];
    } catch {
      this.ownDomains = [];
    }
  }

  public override isPosterFromThisService(posterUrl: string): boolean {
    try {
      return this.ownDomains.includes(new URL(posterUrl).hostname);
    } catch {
      return false;
    }
  }

  private withDummyValues(): string {
    return this.apiKey.replace(PLACEHOLDER_REGEX, 'x');
  }

  public async validateApiKey(): Promise<boolean> {
    const names = [...this.apiKey.matchAll(PLACEHOLDER_REGEX)].flatMap((m) =>
      m[1].split('|')
    );
    const unknown = [...new Set(names)].filter(
      (n) => !KNOWN_PLACEHOLDERS.has(n)
    );
    if (unknown.length) {
      throw new Error(
        `Unknown placeholder(s) in custom poster URL: ${unknown.map((n) => `{${n}}`).join(', ')}`
      );
    }
    if (/[{}]/.test(this.apiKey.replace(PLACEHOLDER_REGEX, ''))) {
      throw new Error(
        'Custom poster URL has braces outside a valid placeholder, e.g. {imdbId} instead of {imdb_id}'
      );
    }
    if (!names.some((n) => n === 'id' || Object.hasOwn(ID_PLACEHOLDERS, n))) {
      throw new Error(
        'Custom poster URL must contain an ID placeholder, e.g. {id} or {imdb_id}'
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(this.withDummyValues());
    } catch {
      throw new Error('Custom poster URL is not a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Custom poster URL must use http or https, got ${parsed.protocol}`
      );
    }
    return true;
  }

  protected buildPosterUrl(): string {
    throw new Error('CustomPoster builds URLs in resolvePosterUrl');
  }

  /** The item's own ID plus anime and IMDb/TMDB/TVDB mappings. */
  private async collectIds(
    type: string,
    id: string
  ): Promise<Partial<Record<IdType, string>>> {
    const parsed = IdParser.parse(id, type);
    if (!parsed) return {};
    const ids: Partial<Record<IdType, string>> = {
      [parsed.type]: String(parsed.value),
    };

    const entry = await AnimeDatabase.getInstance().getEntryById(
      parsed.type,
      parsed.value
    );
    for (const [key, value] of Object.entries(entry?.mappings ?? {})) {
      const idType = key as IdType;
      if (value == null || ids[idType]) continue;
      // Anime mappings give movies their series' TVDB ID.
      if (idType === 'thetvdbId' && type === 'movie') continue;
      ids[idType] = String(value);
    }

    // In-memory lookups, never a request.
    if (type === 'movie' || type === 'series') {
      const mappings = IdMappingDataset.getInstance();
      ids.imdbId ??=
        mappings.imdbIdFor(type, 'tmdb', Number(ids.themoviedbId)) ??
        mappings.imdbIdFor(type, 'tvdb', Number(ids.thetvdbId));
      if (ids.imdbId) {
        const { tmdbId, tvdbId } = mappings.resolve(type, {
          imdbId: ids.imdbId,
          tmdbId: Number(ids.themoviedbId) || undefined,
          tvdbId: Number(ids.thetvdbId) || undefined,
        });
        if (tmdbId) ids.themoviedbId = String(tmdbId);
        if (tvdbId) ids.thetvdbId = String(tvdbId);
      }
    }
    return ids;
  }

  protected override async resolvePosterUrl(
    type: string,
    id: string
  ): Promise<string | null> {
    const ids = await this.collectIds(type, id);
    const values = new Map<string, string | undefined>([
      ['id', id],
      ['type', type],
      ['shape', 'poster'],
    ]);
    for (const [name, idType] of Object.entries(ID_PLACEHOLDERS)) {
      values.set(name, ids[idType]);
    }

    let missingRequired = false;
    const url = this.apiKey.replace(
      PLACEHOLDER_REGEX,
      (_match, names: string, optional?: string) => {
        const value = names
          .split('|')
          .map((n) => values.get(n))
          .find(Boolean);
        if (value) return encodeURIComponent(value);
        if (!optional) missingRequired = true;
        return '';
      }
    );
    return missingRequired ? null : url;
  }
}
