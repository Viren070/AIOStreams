import { z } from 'zod';
import {
  boolOrList,
  byteSize,
  commaSeparatedList,
  optionalPositiveInt,
  positiveInt,
  seconds,
  serviceTimeMap,
  urlString,
} from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const nullableString = z.string().nullable();
const nullableUrl = z.union([urlString, z.null()]);
const stringList = z.array(z.string());

const titleLangMap = z.union([
  z.record(z.string(), z.array(z.string())),
  z.string().transform((value) => {
    const out: Record<string, string[]> = {};
    if (!value.trim()) return out;
    let currentKey: string | null = null;
    for (const token of value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)) {
      const colon = token.indexOf(':');
      if (colon !== -1) {
        currentKey = token.slice(0, colon).trim().toLowerCase();
        const first = token
          .slice(colon + 1)
          .trim()
          .toLowerCase();
        if (currentKey) out[currentKey] = first ? [first] : [];
      } else if (currentKey) {
        out[currentKey].push(token.toLowerCase());
      }
    }
    return out;
  }),
]);

const httpProxyMap = z.union([
  z
    .object({
      torznab: z.string().optional(),
      newznab: z.string().optional(),
    })
    .strict(),
  z.string().transform((value, ctx) => {
    const out: Record<string, string> = {};
    if (!value.trim()) return out;
    for (const entry of value
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)) {
      const colon = entry.indexOf(':');
      if (colon === -1) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid HTTP proxy entry: "${entry}"`,
        });
        return z.NEVER;
      }
      const k = entry.slice(0, colon).trim();
      const v = entry.slice(colon + 1).trim();
      if (k !== 'torznab' && k !== 'newznab') {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid key "${k}". Must be torznab or newznab.`,
        });
        return z.NEVER;
      }
      try {
        new URL(v);
      } catch {
        ctx.addIssue({ code: 'custom', message: `Invalid URL: "${v}"` });
        return z.NEVER;
      }
      out[k] = v;
    }
    return out;
  }),
]);

const debridStore = z.enum(['redis', 'sql', 'memory']);
const boolOrDebridStore = z.union([z.boolean(), debridStore]);

const Day = 86400;
const Week = 7 * Day;

// Byte-size units (base-10, matching the `byteSize` helper + frontend SizeField).
const MB = 1000 * 1000;
const GB = 1000 * MB;

/**
 * Built-in addons.
 */
export const builtinsSchema = {
  stremthru: {
    url: {
      schema: urlString,
      default: 'https://stremthru.13377001.xyz',
      label: 'StremThru URL',
      description:
        'Base URL of the StremThru instance used by the built-in addons.',
      env: 'BUILTIN_STREMTHRU_URL',
      requiresRestart: false,
      secret: false,
    },
    torboxUsenetViaStremthru: {
      schema: z.boolean(),
      default: false,
      label: 'Torbox usenet via StremThru',
      description:
        'Route Torbox usenet operations entirely through StremThru rather than the Torbox API.',
      env: 'TORBOX_USENET_VIA_STREMTHRU',
      requiresRestart: true,
      secret: false,
    },
  },
  debrid: {
    instantAvailabilityCacheTtl: {
      schema: seconds,
      default: 1800,
      label: 'Instant availability cache TTL (s)',
      description: 'Cache TTL for instant-availability checks.',
      env: 'BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    playbackLinkCacheTtl: {
      schema: seconds,
      default: 3600,
      label: 'Playback link cache TTL (s)',
      description: 'Cache TTL for resolved playback links.',
      env: 'BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    errorCacheTtl: {
      schema: seconds,
      default: 3600,
      label: 'Error cache TTL (s)',
      description:
        'How long content-level failures (e.g. download status = failed/invalid) are cached globally to suppress retries.',
      env: 'BUILTIN_DEBRID_ERROR_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    libraryCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Library cache TTL (s)',
      description: 'Cache TTL for library list results (listMagnets/listNzbs).',
      env: 'BUILTIN_DEBRID_LIBRARY_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    libraryStaleThreshold: {
      schema: seconds,
      default: 600,
      label: 'Library stale threshold (s)',
      description:
        'Time after which cached library data is treated as stale (background refresh while serving cached data).',
      env: 'BUILTIN_DEBRID_LIBRARY_STALE_THRESHOLD',
      requiresRestart: false,
      secret: false,
    },
    libraryPageLimit: {
      schema: positiveInt,
      default: 1,
      label: 'Library page limit',
      description: 'Maximum pages fetched per listMagnets / listNzbs request.',
      env: 'BUILTIN_DEBRID_LIBRARY_PAGE_LIMIT',
      requiresRestart: false,
      secret: false,
    },
    libraryPageSize: {
      schema: positiveInt,
      default: 500,
      label: 'Library page size',
      description:
        'Maximum items per page when listing library items. StremThru caps at 500, Torbox at 1000.',
      env: 'BUILTIN_DEBRID_LIBRARY_PAGE_SIZE',
      requiresRestart: false,
      secret: false,
    },
    useTorrentDownloadUrl: {
      schema: z.boolean(),
      default: true,
      label: 'Use torrent download URLs',
      description:
        'Prefer .torrent URLs over magnets for better private-tracker compatibility.',
      env: 'BUILTIN_DEBRID_USE_TORRENT_DOWNLOAD_URL',
      requiresRestart: false,
      secret: false,
    },
    metadataStore: {
      schema: z.union([debridStore, z.null()]),
      default: null,
      label: 'Metadata store',
      description:
        'Backend used to persist debrid metadata. Defaults to the platform-default when unset.',
      env: 'BUILTIN_DEBRID_METADATA_STORE',
      requiresRestart: true,
      secret: false,
    },
    fileinfoStore: {
      schema: boolOrDebridStore,
      default: true,
      label: 'Fileinfo store',
      description:
        'Backend (or `true`/`false`) used for the debrid fileinfo store.',
      env: 'BUILTIN_DEBRID_FILEINFO_STORE',
      requiresRestart: true,
      secret: false,
    },
    playbackLinkValidity: {
      schema: seconds,
      default: Day,
      label: 'Playback link validity (s)',
      description:
        'How long a generated playback link is treated as valid (seconds).',
      env: 'BUILTIN_PLAYBACK_LINK_VALIDITY',
      requiresRestart: false,
      secret: false,
    },
    downloadPollInterval: {
      schema: serviceTimeMap,
      default: {
        nzbdav: 2000,
        altmount: 2000,
        stremthru_newz: 2000,
        '*': 10000,
      } as Record<string, number>,
      label: 'Download poll intervals (ms)',
      description:
        'Per-service download-status poll interval. Env shape: `service:duration,...`. Wildcard `*` covers unlisted services.',
      env: 'BUILTIN_DOWNLOAD_POLL_INTERVAL',
      requiresRestart: false,
      secret: false,
    },
    downloadMaxWaitTime: {
      schema: serviceTimeMap,
      default: {
        nzbdav: 90000,
        altmount: 90000,
        stremthru_newz: 90000,
        '*': 120000,
      } as Record<string, number>,
      label: 'Download max wait times (ms)',
      description:
        'Per-service maximum wait time before timing out a download check. Env shape: `service:duration,...`.',
      env: 'BUILTIN_DOWNLOAD_MAX_WAIT_TIME',
      requiresRestart: false,
      secret: false,
    },
  },
  scrape: {
    withAllTitles: {
      schema: boolOrList,
      default: false,
      label: 'Scrape with alternative titles',
      description: {
        ui: 'Use alternative titles when scraping built-in addons. Either a boolean or a comma-separated hostname list.',
        env: 'By default, built-in addons only use the primary title for text-based queries. `true` enables all alternative titles for every indexer; `false` (default) uses the primary title only; a comma-separated hostname list (e.g. `jackett,knaben.org`) enables it only for those indexers. Superseded per-indexer by BUILTIN_SCRAPE_TITLE_LANGUAGES.',
      },
      env: 'BUILTIN_SCRAPE_WITH_ALL_TITLES',
      requiresRestart: false,
      secret: false,
    },
    titleLanguages: {
      schema: titleLangMap,
      default: {} as Record<string, string[]>,
      label: 'Title languages',
      description: {
        ui: 'Per-domain control over which titles to use when scraping. Format: `domain:spec,...` where spec is one of `default`, `all`, `original`, or an ISO 639-1 code.',
        env:
          'Fine-grained alternative-title control, per indexer hostname, indexer name, or addon type. Supersedes BUILTIN_SCRAPE_WITH_ALL_TITLES. ' +
          'Format: `<key>:<spec>[,<spec>...][,<key>:<spec>...]`. ' +
          'Keys (checked in priority order): exact indexer hostname (e.g. `my-indexer.com`); auto-extracted indexer name (Jackett `/api/v2.0/indexers/<name>/...`, NZBHydra2 `?indexers=<name>`); addon-id (`newznab`, `torznab`, `easynews`, `knaben`, `prowlarr`, `torrent-galaxy`); `*` wildcard fallback. ' +
          'Specs: `default` (primary/English-style title), `all` (all alternative titles up to BUILTIN_SCRAPE_TITLE_LIMIT), `original` (TMDB original-language title), `<lang>` (ISO 639-1 code, e.g. `de`, `fr`). ' +
          'Multiple specs under one key are combined (duplicates removed); only the highest-priority matching key applies; always falls back to the primary title. ' +
          'Examples: `*:default,original` — every indexer gets default + TMDB original-language title. `*:default,newznab:default,original,de` — newznab indexers query English + original + German, others English only. `*:default,germanindexer.com:de,default` — germanindexer.com queries German + English, all others English only.',
      },
      env: 'BUILTIN_SCRAPE_TITLE_LANGUAGES',
      requiresRestart: false,
      secret: false,
    },
    titleLimit: {
      schema: positiveInt,
      default: 3,
      label: 'Title limit',
      description: 'Maximum alternative titles used per scrape.',
      env: 'BUILTIN_SCRAPE_TITLE_LIMIT',
      requiresRestart: false,
      secret: false,
    },
    queryConcurrency: {
      schema: positiveInt,
      default: 5,
      label: 'Query concurrency',
      description: 'Maximum concurrent scrape queries.',
      env: 'BUILTIN_SCRAPE_QUERY_CONCURRENCY',
      requiresRestart: false,
      secret: false,
    },
  },
  getTorrent: {
    timeout: {
      schema: positiveInt,
      default: 5000,
      label: 'Get-torrent timeout (ms)',
      description: 'Timeout for fetching torrent files.',
      env: 'BUILTIN_GET_TORRENT_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
    concurrency: {
      schema: positiveInt,
      default: 100,
      label: 'Get-torrent concurrency',
      description: 'Maximum concurrent torrent fetches.',
      env: 'BUILTIN_GET_TORRENT_CONCURRENCY',
      requiresRestart: false,
      secret: false,
    },
    lazily: {
      schema: z.boolean(),
      default: true,
      label: 'Lazy torrent fetching',
      description:
        'Fetch torrents lazily in the background. First search returns immediately with available results.',
      env: 'BUILTIN_GET_TORRENT_LAZILY',
      requiresRestart: false,
      secret: false,
    },
  },
  torrent: {
    metadataCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Torrent metadata cache TTL (s)',
      description: 'Cache TTL for torrent metadata.',
      env: 'BUILTIN_TORRENT_METADATA_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    minimumBackgroundRefreshInterval: {
      schema: seconds,
      default: Day,
      label: 'Minimum background refresh interval (s)',
      description:
        'Minimum interval between background search-cache refreshes triggered during normal searches.',
      env: 'BUILTIN_MINIMUM_BACKGROUND_REFRESH_INTERVAL',
      requiresRestart: false,
      secret: false,
    },
  },
  grab: {
    nzbCacheBytes: {
      schema: byteSize,
      default: 64 * MB,
      label: 'NZB grab cache size',
      description:
        'In-memory cache size for grabbed .nzb files. Accepts plain bytes or `64MB`-style strings.',
      env: 'BUILTIN_NZB_GRAB_CACHE_BYTES',
      requiresRestart: false,
      secret: false,
    },
    nzbDiskCacheBytes: {
      schema: byteSize,
      default: 1 * GB,
      label: 'NZB grab disk cache size',
      description:
        'On-disk cache size for grabbed .nzb files (survives restarts). Set to ' +
        '`0` to disable the disk tier. Accepts plain bytes or `1GB`-style strings.',
      env: 'BUILTIN_NZB_GRAB_DISK_CACHE_BYTES',
      requiresRestart: false,
      secret: false,
    },
    torrentCacheBytes: {
      schema: byteSize,
      default: 64 * MB,
      label: 'Torrent grab cache size',
      description:
        'In-memory cache size for grabbed .torrent files. Accepts plain bytes or `64MB`-style strings.',
      env: 'BUILTIN_TORRENT_GRAB_CACHE_BYTES',
      requiresRestart: false,
      secret: false,
    },
    torrentDiskCacheBytes: {
      schema: byteSize,
      default: 512 * MB,
      label: 'Torrent grab disk cache size',
      description:
        'On-disk cache size for grabbed .torrent files (survives restarts). Set ' +
        'to `0` to disable the disk tier. Accepts plain bytes or `512MB`-style strings.',
      env: 'BUILTIN_TORRENT_GRAB_DISK_CACHE_BYTES',
      requiresRestart: false,
      secret: false,
    },
  },
  gdrive: {
    clientId: {
      schema: nullableString,
      default: null,
      label: 'Google Drive client ID',
      env: 'BUILTIN_GDRIVE_CLIENT_ID',
      description: 'OAuth client ID for the Google Drive built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    clientSecret: {
      schema: nullableString,
      default: null,
      label: 'Google Drive client secret',
      env: 'BUILTIN_GDRIVE_CLIENT_SECRET',
      description: 'OAuth client secret for the Google Drive built-in addon.',
      requiresRestart: false,
      secret: true,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Google Drive timeout (ms)',
      env: 'BUILTIN_GDRIVE_TIMEOUT',
      description: 'Timeout for Google Drive requests.',
      requiresRestart: false,
      secret: false,
    },
    userAgent: {
      schema: nullableString,
      default: null,
      label: 'Google Drive user agent',
      env: 'BUILTIN_GDRIVE_USER_AGENT',
      description: 'User-Agent for Google Drive requests.',
      requiresRestart: false,
      secret: false,
    },
    pageSizeLimit: {
      schema: positiveInt,
      default: 1000,
      label: 'Google Drive page size limit',
      env: 'BUILTIN_GDRIVE_PAGE_SIZE_LIMIT',
      description: 'Maximum items per page from Google Drive API.',
      requiresRestart: false,
      secret: false,
    },
  },
  torboxSearch: {
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Torbox Search timeout (ms)',
      env: 'BUILTIN_TORBOX_SEARCH_TIMEOUT',
      description: 'Timeout for Torbox Search requests.',
      requiresRestart: false,
      secret: false,
    },
    userAgent: {
      schema: nullableString,
      default: null,
      label: 'Torbox Search user agent',
      env: 'BUILTIN_TORBOX_SEARCH_USER_AGENT',
      description: 'User-Agent for Torbox Search requests.',
      requiresRestart: false,
      secret: false,
    },
    searchApiTimeout: {
      schema: positiveInt,
      default: 30000,
      label: 'Torbox Search API timeout (ms)',
      env: 'BUILTIN_TORBOX_SEARCH_SEARCH_API_TIMEOUT',
      description: 'Timeout for the Torbox /search API.',
      requiresRestart: false,
      secret: false,
    },
    searchApiCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Torbox Search API cache TTL (s)',
      env: 'BUILTIN_TORBOX_SEARCH_SEARCH_API_CACHE_TTL',
      description: 'Cache TTL for /search responses.',
      requiresRestart: false,
      secret: false,
    },
    metadataCacheTtl: {
      schema: seconds,
      default: 14 * Day,
      label: 'Torbox Search metadata cache TTL (s)',
      env: 'BUILTIN_TORBOX_SEARCH_METADATA_CACHE_TTL',
      description: 'Cache TTL for Torbox Search metadata.',
      requiresRestart: false,
      secret: false,
    },
    cachePerUserSearchEngine: {
      schema: z.boolean(),
      default: false,
      label: 'Cache per-user search engine',
      env: 'BUILTIN_TORBOX_SEARCH_CACHE_PER_USER_SEARCH_ENGINE',
      description:
        'Cache search results separately per user when they bring their own search engine.',
      requiresRestart: false,
      secret: false,
    },
  },
  nab: {
    searchTimeout: {
      schema: positiveInt,
      default: 30000,
      label: 'Newznab/Torznab search timeout (ms)',
      env: 'BUILTIN_NAB_SEARCH_TIMEOUT',
      description: 'Timeout for Newznab/Torznab search calls.',
      requiresRestart: false,
      secret: false,
    },
    searchCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Newznab/Torznab search cache TTL (s)',
      env: 'BUILTIN_NAB_SEARCH_CACHE_TTL',
      description: 'Cache TTL for Newznab/Torznab search results.',
      requiresRestart: false,
      secret: false,
    },
    capabilitiesCacheTtl: {
      schema: seconds,
      default: 14 * Day,
      label: 'Newznab/Torznab capabilities cache TTL (s)',
      env: 'BUILTIN_NAB_CAPABILITIES_CACHE_TTL',
      description: 'Cache TTL for Newznab/Torznab capabilities responses.',
      requiresRestart: false,
      secret: false,
    },
    userAgent: {
      schema: nullableString,
      default: null,
      label: 'Newznab/Torznab user agent',
      env: 'BUILTIN_NAB_USER_AGENT',
      description:
        'Deprecated: prefer `[newznab]`/`[torznab]` entries in ' +
        '`REQUEST_HEADER_OVERRIDES` (which also support `{preset}` header ' +
        'sets). User-Agent for Newznab/Torznab requests; the fallback when no ' +
        'host/context override matches.',
      requiresRestart: false,
      secret: false,
    },
    httpProxy: {
      schema: httpProxyMap,
      default: {} as Record<string, string>,
      label: 'Newznab/Torznab HTTP proxy',
      env: 'BUILTIN_NAB_HTTP_PROXY',
      description:
        'Deprecated: add the proxy URL to `ADDON_PROXY` and route Newznab/Torznab ' +
        'through it with a `[newznab]`/`[torznab]` entry in `ADDON_PROXY_CONFIG` ' +
        '(e.g. `[newznab]:0`). Per-protocol HTTP proxy override ' +
        '(`torznab:URL,newznab:URL`); still honoured and overrides the global ' +
        'addon proxy when set.',
      requiresRestart: false,
      secret: false,
    },
    maxPages: {
      schema: positiveInt,
      default: 5,
      label: 'Newznab/Torznab max pages',
      env: 'BUILTIN_NAB_MAX_PAGES',
      description:
        'Maximum pages to fetch when paginating Newznab/Torznab results.',
      requiresRestart: false,
      secret: false,
    },
  },
  zilean: {
    url: {
      schema: urlString,
      default: 'https://zileanfortheweebs.midnightignite.me',
      label: 'Zilean URL',
      env: 'BUILTIN_ZILEAN_URL',
      description: 'Base URL for the Zilean built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Zilean timeout (ms)',
      env: 'BUILTIN_DEFAULT_ZILEAN_TIMEOUT',
      description: 'Timeout for Zilean requests.',
      requiresRestart: false,
      secret: false,
    },
  },
  animetosho: {
    url: {
      schema: urlString,
      default: 'https://feed.animetosho.org',
      label: 'AnimeTosho URL',
      env: 'BUILTIN_ANIMETOSHO_URL',
      description: 'Base URL for the AnimeTosho built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'AnimeTosho timeout (ms)',
      env: 'BUILTIN_DEFAULT_ANIMETOSHO_TIMEOUT',
      description: 'Timeout for AnimeTosho requests.',
      requiresRestart: false,
      secret: false,
    },
  },
  nekobt: {
    url: {
      schema: urlString,
      default: 'https://nekobt.to/api/torznab',
      label: 'NekoBT URL',
      env: 'BUILTIN_NEKOBT_URL',
      description: 'Base URL for the NekoBT built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'NekoBT timeout (ms)',
      env: 'BUILTIN_DEFAULT_NEKOBT_TIMEOUT',
      description: 'Timeout for NekoBT requests.',
      requiresRestart: false,
      secret: false,
    },
  },
  seadex: {
    url: {
      schema: urlString,
      default: 'https://releases.moe',
      label: 'SeaDex URL',
      env: 'BUILTIN_SEADEX_URL',
      description: 'Base URL for the SeaDex built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    datasetRefreshInterval: {
      schema: seconds,
      default: Day,
      label: 'SeaDex dataset refresh (s)',
      env: 'BUILTIN_SEADEX_DATASET_REFRESH_INTERVAL',
      description: 'How often the SeaDex dataset is refreshed.',
      requiresRestart: true,
      secret: false,
    },
  },
  bitmagnet: {
    url: {
      schema: nullableUrl,
      default: null,
      label: 'Bitmagnet URL',
      env: 'BUILTIN_BITMAGNET_URL',
      description: 'Base URL for the Bitmagnet built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Bitmagnet timeout (ms)',
      env: 'BUILTIN_DEFAULT_BITMAGNET_TIMEOUT',
      description: 'Timeout for Bitmagnet requests.',
      requiresRestart: false,
      secret: false,
    },
  },
  jackett: {
    url: {
      schema: nullableUrl,
      default: null,
      label: 'Jackett URL',
      env: 'BUILTIN_JACKETT_URL',
      description: 'Base URL for the Jackett built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    apiKey: {
      schema: nullableString,
      default: null,
      label: 'Jackett API key',
      env: 'BUILTIN_JACKETT_API_KEY',
      description: 'API key for the Jackett built-in addon.',
      requiresRestart: false,
      secret: true,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Jackett timeout (ms)',
      env: 'BUILTIN_DEFAULT_JACKETT_TIMEOUT',
      description: 'Timeout for Jackett requests.',
      requiresRestart: false,
      secret: false,
    },
  },
  nzbhydra: {
    url: {
      schema: nullableUrl,
      default: null,
      label: 'NZBHydra URL',
      env: 'BUILTIN_NZBHYDRA_URL',
      description: 'Base URL for the NZBHydra built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    apiKey: {
      schema: nullableString,
      default: null,
      label: 'NZBHydra API key',
      env: 'BUILTIN_NZBHYDRA_API_KEY',
      description: 'API key for the NZBHydra built-in addon.',
      requiresRestart: false,
      secret: true,
    },
    timeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'NZBHydra timeout (ms)',
      env: 'BUILTIN_DEFAULT_NZBHYDRA_TIMEOUT',
      description: 'Timeout for NZBHydra requests.',
      requiresRestart: false,
      secret: false,
    },
  },
  prowlarr: {
    url: {
      schema: nullableUrl,
      default: null,
      label: 'Prowlarr URL',
      env: 'BUILTIN_PROWLARR_URL',
      description: 'Base URL for the Prowlarr built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    apiKey: {
      schema: nullableString,
      default: null,
      label: 'Prowlarr API key',
      env: 'BUILTIN_PROWLARR_API_KEY',
      description: 'API key for the Prowlarr built-in addon.',
      requiresRestart: false,
      secret: true,
    },
    indexers: {
      schema: commaSeparatedList,
      default: [] as string[],
      label: 'Prowlarr indexers',
      env: 'BUILTIN_PROWLARR_INDEXERS',
      description: 'Comma-separated list of Prowlarr indexers to query.',
      requiresRestart: false,
      secret: false,
    },
    defaultTimeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Prowlarr default timeout (ms)',
      env: 'BUILTIN_DEFAULT_PROWLARR_TIMEOUT',
      description: 'Default timeout for Prowlarr requests.',
      requiresRestart: false,
      secret: false,
    },
    searchTimeout: {
      schema: positiveInt,
      default: 30000,
      label: 'Prowlarr search timeout (ms)',
      env: 'BUILTIN_PROWLARR_SEARCH_TIMEOUT',
      description: 'Timeout for Prowlarr search requests.',
      requiresRestart: false,
      secret: false,
    },
    searchCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Prowlarr search cache TTL (s)',
      env: 'BUILTIN_PROWLARR_SEARCH_CACHE_TTL',
      description: 'Cache TTL for Prowlarr search results.',
      requiresRestart: false,
      secret: false,
    },
    indexersCacheTtl: {
      schema: seconds,
      default: 14 * Day,
      label: 'Prowlarr indexers cache TTL (s)',
      env: 'BUILTIN_PROWLARR_INDEXERS_CACHE_TTL',
      description: 'Cache TTL for the Prowlarr indexers list.',
      requiresRestart: false,
      secret: false,
    },
  },
  knaben: {
    defaultTimeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Knaben default timeout (ms)',
      env: 'BUILTIN_DEFAULT_KNABEN_TIMEOUT',
      description: 'Default timeout for Knaben requests.',
      requiresRestart: false,
      secret: false,
    },
    searchTimeout: {
      schema: positiveInt,
      default: 30000,
      label: 'Knaben search timeout (ms)',
      env: 'BUILTIN_KNABEN_SEARCH_TIMEOUT',
      description: 'Timeout for Knaben search requests.',
      requiresRestart: false,
      secret: false,
    },
    downloadTorrents: {
      schema: z.boolean(),
      default: true,
      label: 'Knaben: download torrent files',
      env: 'BUILTIN_KNABEN_DOWNLOAD_TORRENTS',
      description:
        'When true, attempt to fetch .torrent files for Knaben results without an infohash.',
      requiresRestart: false,
      secret: false,
    },
    searchCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Knaben search cache TTL (s)',
      env: 'BUILTIN_KNABEN_SEARCH_CACHE_TTL',
      description: 'Cache TTL for Knaben search results.',
      requiresRestart: false,
      secret: false,
    },
  },
  easynews: {
    searchTimeout: {
      schema: positiveInt,
      default: 30000,
      label: 'Easynews search timeout (ms)',
      env: 'BUILTIN_EASYNEWS_SEARCH_TIMEOUT',
      description: 'Timeout for Easynews search requests.',
      requiresRestart: false,
      secret: false,
    },
    searchCacheTtl: {
      schema: seconds,
      default: 3600,
      label: 'Easynews search cache TTL (s)',
      env: 'BUILTIN_EASYNEWS_SEARCH_CACHE_TTL',
      description:
        'Cache TTL for Easynews search results. Defaults to 1h since Easynews content rotates more frequently.',
      requiresRestart: false,
      secret: false,
    },
    maxPages: {
      schema: positiveInt,
      default: 5,
      label: 'Easynews max pages',
      env: 'BUILTIN_EASYNEWS_SEARCH_MAX_PAGES',
      description:
        'Maximum pages fetched when paginating Easynews search results.',
      requiresRestart: false,
      secret: false,
    },
  },
  torrentGalaxy: {
    url: {
      schema: urlString,
      default: 'https://torrentgalaxy.one',
      label: 'Torrent Galaxy URL',
      env: 'BUILTIN_TORRENT_GALAXY_URL',
      description: 'Base URL for the Torrent Galaxy built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    defaultTimeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'Torrent Galaxy default timeout (ms)',
      env: 'BUILTIN_DEFAULT_TORRENT_GALAXY_TIMEOUT',
      description: 'Default timeout for Torrent Galaxy requests.',
      requiresRestart: false,
      secret: false,
    },
    searchTimeout: {
      schema: positiveInt,
      default: 30000,
      label: 'Torrent Galaxy search timeout (ms)',
      env: 'BUILTIN_TORRENT_GALAXY_SEARCH_TIMEOUT',
      description: 'Timeout for Torrent Galaxy search requests.',
      requiresRestart: false,
      secret: false,
    },
    searchCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Torrent Galaxy search cache TTL (s)',
      env: 'BUILTIN_TORRENT_GALAXY_SEARCH_CACHE_TTL',
      description: 'Cache TTL for Torrent Galaxy search results.',
      requiresRestart: false,
      secret: false,
    },
    pageLimit: {
      schema: positiveInt,
      default: 5,
      label: 'Torrent Galaxy page limit',
      env: 'BUILTIN_TORRENT_GALAXY_PAGE_LIMIT',
      description:
        'Maximum pages fetched when paginating Torrent Galaxy results.',
      requiresRestart: false,
      secret: false,
    },
  },
  eztv: {
    url: {
      schema: urlString,
      default: 'https://eztvx.to',
      label: 'EZTV URL',
      env: 'BUILTIN_EZTV_URL',
      description: 'Base URL for the EZTV built-in addon.',
      requiresRestart: false,
      secret: false,
    },
    defaultTimeout: {
      schema: optionalPositiveInt,
      default: null,
      label: 'EZTV default timeout (ms)',
      env: 'BUILTIN_DEFAULT_EZTV_TIMEOUT',
      description: 'Default timeout for EZTV requests.',
      requiresRestart: false,
      secret: false,
    },
    searchTimeout: {
      schema: positiveInt,
      default: 30000,
      label: 'EZTV search timeout (ms)',
      env: 'BUILTIN_EZTV_SEARCH_TIMEOUT',
      description: 'Timeout for EZTV search requests.',
      requiresRestart: false,
      secret: false,
    },
    searchCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'EZTV search cache TTL (s)',
      env: 'BUILTIN_EZTV_SEARCH_CACHE_TTL',
      description: 'Cache TTL for EZTV search results.',
      requiresRestart: false,
      secret: false,
    },
    maxPages: {
      schema: positiveInt,
      default: 5,
      label: 'EZTV max pages',
      env: 'BUILTIN_EZTV_MAX_PAGES',
      description: 'Maximum pages fetched when paginating EZTV results.',
      requiresRestart: false,
      secret: false,
    },
  },
} as const satisfies RuntimeConfigSection;
