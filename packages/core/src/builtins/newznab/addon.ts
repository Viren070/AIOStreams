import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import { constants, createLogger } from '../../utils/index.js';
import { Torrent, NZB } from '../../debrid/index.js';
import { SearchMetadata } from '../base/debrid.js';
import { hashNzbUrl } from '../../debrid/utils.js';
import { toUnixSeconds, usenetKey } from '../../release-blocklist/index.js';
import { BaseNabApi, SearchResultItem } from '../base/nab/api.js';
import {
  BaseNabAddon,
  NabAddonConfigSchema,
  NabAddonConfig,
  parseNabParsedFileInfo,
} from '../base/nab/addon.js';
import { ageInHoursSince, proxyNzbs } from '../utils/general.js';

const logger = createLogger('newznab');

class NewznabApi extends BaseNabApi<'newznab'> {
  constructor(baseUrl: string, apiKey?: string, apiPath?: string) {
    super('newznab', logger, baseUrl, apiKey, apiPath);
  }
}

export const NewznabAddonConfigSchema = NabAddonConfigSchema.extend({
  proxyAuth: z.string().optional(),
});
export type NewznabAddonConfig = z.infer<typeof NewznabAddonConfigSchema>;

// Addon class
export class NewznabAddon extends BaseNabAddon<NewznabAddonConfig, NewznabApi> {
  readonly name = 'Newznab';
  readonly version = '1.0.0';
  readonly id = 'newznab';
  readonly logger = logger;
  readonly api: NewznabApi;
  constructor(userData: NewznabAddonConfig, clientIp?: string) {
    super(userData, NewznabAddonConfigSchema, clientIp);

    if (
      userData.services.some(
        (s: NonNullable<NewznabAddonConfig['services']>[number]) =>
          ![
            constants.TORBOX_SERVICE,
            constants.NZBDAV_SERVICE,
            constants.ALTMOUNT_SERVICE,
            constants.STREMIO_NNTP_SERVICE,
            constants.STREMTHRU_NEWZ_SERVICE,
            constants.AIOSTREAMS_SERVICE,
          ].includes(s.id)
      )
    ) {
      throw new Error(
        'The Newznab addon only supports TorBox and NZB DAV services'
      );
    }
    this.api = new NewznabApi(
      this.userData.url,
      this.userData.apiKey,
      this.userData.apiPath
    );
  }

  protected async _searchNzbs(parsedId: ParsedId): Promise<NZB[]> {
    const metadata = await this.getSearchMetadata();
    const { results, meta } = await this.performSearch(parsedId, metadata);
    const seenNzbs = new Set<string>();

    const nzbs: NZB[] = [];
    for (const result of results) {
      const enclosure = this.getEnclosure(result);
      const nzbUrl = enclosure?.url;
      if (!nzbUrl) continue;
      if (seenNzbs.has(nzbUrl)) continue;
      seenNzbs.add(nzbUrl);

      const md5 = hashNzbUrl(nzbUrl);

      let date = result.pubDate?.toString();
      if (typeof result.newznab?.usenetdate === 'string') {
        date = result.newznab.usenetdate;
      }
      const age = date ? ageInHoursSince(date) : undefined;
      const parsedMediaInfo = parseNabParsedFileInfo({
        audioLanguages: result.newznab?.language,
        subtitleLanguages: result.newznab?.subs,
      });
      const nzb: NZB = {
        confirmed: meta.searchType === 'id',
        hash: md5,
        nzb: nzbUrl,
        age: age,
        title: result.title,
        indexer:
          result.newznab?.sourceIndexerName?.toString() ??
          result.newznab?.hydraIndexerName?.toString() ??
          result.prowlarrindexer?.name ??
          meta.capabilities.server.title,
        size:
          result.size ??
          (result.newznab?.size ? Number(result.newznab.size) : undefined) ??
          enclosure?.length ??
          0,
        type: 'usenet',
        parsedMediaInfo,
        // As Prowlarr does: https://github.com/Prowlarr/Prowlarr/blob/3c6e1d97ac485a70cc9d4063dd5d17af7a77584d/src/NzbDrone.Core/Indexers/Definitions/Newznab/NewznabRssParser.cs#L123-L126
        infoUrl: result.comments?.replace(/#comments$/, ''),
      };

      const keySize =
        typeof enclosure?.length === 'number' && enclosure.length > 0
          ? enclosure.length
          : result.newznab?.size
            ? Number(result.newznab.size)
            : 0;
      const releaseKey = usenetKey(
        keySize,
        typeof result.newznab?.poster === 'string'
          ? result.newznab.poster
          : null,
        toUnixSeconds(date)
      );
      if (releaseKey) {
        nzb.releaseKey = releaseKey;
      }

      nzbs.push(nzb);
    }

    if (this.userData.proxyAuth) {
      await proxyNzbs(nzbs, this.userData.proxyAuth);
    }
    return nzbs;
  }

  protected async _searchTorrents(_parsedId: ParsedId): Promise<Torrent[]> {
    return [];
  }

  private getEnclosure(result: any) {
    return result.enclosure?.find((e: any) =>
      e.type?.toLowerCase().includes('nzb')
    );
  }
}
