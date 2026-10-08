import { z } from 'zod';
import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../base/debrid.js';
import { createLogger, ParsedId } from '../../utils/index.js';
import { NZB, UnprocessedTorrent } from '../../debrid/utils.js';

const logger = createLogger('cauldron');

export const CauldronAddonConfigSchema = z.object({
  ...BaseDebridConfigSchema.shape,
  baseUrl: z.string().url().default('http://localhost:8008'),
});

export type CauldronAddonConfig = z.infer<typeof CauldronAddonConfigSchema>;

export class CauldronAddon extends BaseDebridAddon<CauldronAddonConfig> {
  readonly id = 'cauldron';
  readonly name = 'Cauldron';
  readonly version = '1.0.0';
  readonly logger = logger;

  constructor(userData: CauldronAddonConfig, clientIp?: string) {
    super(userData, CauldronAddonConfigSchema, clientIp);
  }

  static getManifest() {
    return new CauldronAddon({ services: [], baseUrl: 'http://localhost:8008' }).getManifest();
  }

  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    return [];
  }

  private getBaseUrl(): string {
    return this.userData.baseUrl.replace(/\/+$/, '');
  }

  protected async _searchTorrents(
    parsedId: ParsedId
  ): Promise<UnprocessedTorrent[]> {
    const metadata: SearchMetadata = await this.getSearchMetadata();
    if (!metadata.primaryTitle) return [];

    const searchUrl = new URL(`${this.getBaseUrl()}/api/search`);
    searchUrl.searchParams.set('q', metadata.primaryTitle);
    searchUrl.searchParams.set('media_type', parsedId.mediaType);
    if (metadata.imdbId) {
      searchUrl.searchParams.set('imdb_id', metadata.imdbId.replace(/^tt/i, ''));
    }
    if (parsedId.season) searchUrl.searchParams.set('season', parsedId.season);
    if (parsedId.episode) searchUrl.searchParams.set('episode', parsedId.episode);

    const response = await fetch(searchUrl.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Cauldron search failed: ${response.status} ${response.statusText}`);
    }

    const results = (await response.json()) as Array<{
      title?: string;
      magnet?: string;
      info_hash?: string;
      size_bytes?: number;
      seeders?: number;
      leechers?: number;
      source?: string;
      quality?: string;
      codec?: string;
    }>;

    return (results ?? []).map((result, index) => {
      const magnet = result.magnet;
      return {
        type: 'torrent' as const,
        title: result.title ?? `${this.name} ${index + 1}`,
        hash: result.info_hash ?? (magnet ? this.hashFromMagnet(magnet) : undefined),
        downloadUrl: undefined,
        sources: magnet ? this.trackersFromMagnet(magnet) : [],
        indexer: result.source,
        size: result.size_bytes ?? 0,
        seeders: result.seeders,
      };
    });
  }

  private hashFromMagnet(magnet: string): string | undefined {
    try {
      return new URL(magnet.replace('&amp;', '&')).searchParams
        .get('xt')
        ?.match(/urn:btih:([a-f0-9]{40})/i)?.[1]
        ?.toLowerCase();
    } catch {
      return undefined;
    }
  }

  private trackersFromMagnet(magnet: string): string[] {
    try {
      return new URL(magnet.replace('&amp;', '&')).searchParams.getAll('tr');
    } catch {
      return [];
    }
  }
}
