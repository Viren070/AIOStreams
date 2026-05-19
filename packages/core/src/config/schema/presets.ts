import { z } from 'zod';
import {
  nullableUserAgentString,
  optionalPositiveInt,
  positiveInt,
  urlOrUrlList,
  urlString,
} from './helpers.js';
import type { RuntimeConfigField, RuntimeConfigSection } from '../types.js';

const nullableString = z.string().nullable();
const nullableUrl = z.union([urlString, z.null()]);

const stringList = z.array(z.string());
const stringOrStringList = z.union([
  stringList,
  z.string().transform((value) => {
    const trimmed = value.trim();
    if (!trimmed) return [] as string[];
    try {
      const parsed = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
      ) {
        return parsed as string[];
      }
    } catch {
      /* fall through */
    }
    return [trimmed];
  }),
]);

interface PresetFieldOptions {
  label: string;
  default: string | string[] | null;
  envBase: string;
  description?: string;
}

function urlField({
  label,
  default: def,
  envBase,
  description,
}: PresetFieldOptions): RuntimeConfigField<string[]> {
  const coerced: string[] = Array.isArray(def) ? def : def ? [def] : [];
  return {
    schema: urlOrUrlList,
    default: coerced,
    label: `${label} URL(s)`,
    description: description ?? `Upstream URL(s) for the ${label} addon.`,
    env: envBase,
    requiresRestart: false,
    secret: false,
    ui: { kind: 'list' },
  };
}

function timeoutField(
  label: string,
  env: string
): RuntimeConfigField<number | null> {
  return {
    schema: optionalPositiveInt,
    default: null,
    label: `Default ${label} timeout (ms)`,
    description: `Default timeout for the ${label} addon (milliseconds). Falls back to the global default when unset.`,
    env,
    requiresRestart: false,
    secret: false,
  };
}

function userAgentField(
  label: string,
  env: string
): RuntimeConfigField<string | null> {
  return {
    schema: nullableUserAgentString,
    default: null,
    label: `Default ${label} user agent`,
    description: `Default User-Agent for the ${label} addon. Supports \`{version}\`/\`{random}\` placeholders.`,
    env,
    requiresRestart: false,
    secret: false,
  };
}

type BasicPresetShape = {
  url: RuntimeConfigField<string[]>;
  defaultTimeout: RuntimeConfigField<number | null>;
  defaultUserAgent: RuntimeConfigField<string | null>;
};

/**
 * Concise builder for the standard {url, defaultTimeout, defaultUserAgent}
 * preset shape.
 */
function basicPreset<E extends Record<string, RuntimeConfigField<any>>>(opts: {
  label: string;
  default: string | string[] | null;
  envBase: string;
  timeoutEnv: string;
  userAgentEnv: string;
  extras?: E;
}): BasicPresetShape & E {
  const base: BasicPresetShape = {
    url: urlField({
      label: opts.label,
      default: opts.default,
      envBase: opts.envBase,
    }),
    defaultTimeout: timeoutField(opts.label, opts.timeoutEnv),
    defaultUserAgent: userAgentField(opts.label, opts.userAgentEnv),
  };
  return (
    opts.extras ? { ...base, ...opts.extras } : base
  ) as BasicPresetShape & E;
}

/**
 * Third-party Stremio addons.
 */
export const presetsSchema = {
  defaultTimeout: {
    schema: positiveInt,
    default: 7000,
    label: 'Default preset timeout (ms)',
    description:
      'Fallback timeout for preset stream fetching when a preset does not set its own (milliseconds).',
    env: 'DEFAULT_TIMEOUT',
    requiresRestart: false,
    secret: false,
  },
  comet: basicPreset({
    label: 'Comet',
    default: ['https://comet.feels.legal'],
    envBase: 'COMET_URL',
    timeoutEnv: 'DEFAULT_COMET_TIMEOUT',
    userAgentEnv: 'DEFAULT_COMET_USER_AGENT',
    extras: {
      publicApiToken: {
        schema: stringOrStringList,
        default: [] as string[],
        label: 'Comet public API token(s)',
        description:
          'Public API token(s) used by Comet. JSON array or single string.',
        env: 'COMET_PUBLIC_API_TOKEN',
        requiresRestart: false,
        secret: false,
      },
    },
  }),
  meteor: basicPreset({
    label: 'Meteor',
    default: ['https://meteorfortheweebs.midnightignite.me'],
    envBase: 'METEOR_URL',
    timeoutEnv: 'DEFAULT_METEOR_TIMEOUT',
    userAgentEnv: 'DEFAULT_METEOR_USER_AGENT',
  }),
  mediafusion: basicPreset({
    label: 'MediaFusion',
    default: ['https://mediafusion.elfhosted.com'],
    envBase: 'MEDIAFUSION_URL',
    timeoutEnv: 'DEFAULT_MEDIAFUSION_TIMEOUT',
    userAgentEnv: 'DEFAULT_MEDIAFUSION_USER_AGENT',
    extras: {
      apiPassword: {
        schema: z.string(),
        default: '',
        label: 'MediaFusion API password',
        description: 'API password sent to MediaFusion.',
        env: 'MEDIAFUSION_API_PASSWORD',
        requiresRestart: false,
        secret: true,
      },
      defaultUseCachedResultsOnly: {
        schema: z.boolean(),
        default: true,
        label: 'MediaFusion: default to cached results only',
        description:
          'Default value of MediaFusion\'s "cached results only" toggle.',
        env: 'MEDIAFUSION_DEFAULT_USE_CACHED_RESULTS_ONLY',
        requiresRestart: false,
        secret: false,
      },
      forcedUseCachedResultsOnly: {
        schema: z.union([z.boolean(), z.null()]),
        default: null,
        label: 'MediaFusion: force cached results only',
        description:
          'When set, overrides users\' "cached results only" toggle.',
        env: 'MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY',
        requiresRestart: false,
        secret: false,
      },
    },
  }),
  jackettio: basicPreset({
    label: 'Jackettio',
    default: ['https://jackettio.elfhosted.com'],
    envBase: 'JACKETTIO_URL',
    timeoutEnv: 'DEFAULT_JACKETTIO_TIMEOUT',
    userAgentEnv: 'DEFAULT_JACKETTIO_USER_AGENT',
    extras: {
      defaultIndexers: {
        schema: stringList,
        default: ['eztv', 'thepiratebay', 'therarbg', 'yts'],
        label: 'Jackettio default indexers',
        description:
          'Default indexer list applied when creating Jackettio configs. JSON array of strings.',
        env: 'DEFAULT_JACKETTIO_INDEXERS',
        requiresRestart: false,
        secret: false,
      },
      defaultStremthruUrl: {
        schema: urlString,
        default: 'https://stremthru.13377001.xyz',
        label: 'Jackettio default StremThru URL',
        description: 'Default StremThru URL passed to new Jackettio configs.',
        env: 'DEFAULT_JACKETTIO_STREMTHRU_URL',
        requiresRestart: false,
        secret: false,
      },
    },
  }),
  torrentio: basicPreset({
    label: 'Torrentio',
    default: ['https://torrentio.strem.fun'],
    envBase: 'TORRENTIO_URL',
    timeoutEnv: 'DEFAULT_TORRENTIO_TIMEOUT',
    userAgentEnv: 'DEFAULT_TORRENTIO_USER_AGENT',
  }),
  orion: basicPreset({
    label: 'Orion',
    default: ['https://5a0d1888fa64-orion.baby-beamup.club'],
    envBase: 'ORION_STREMIO_ADDON_URL',
    timeoutEnv: 'DEFAULT_ORION_TIMEOUT',
    userAgentEnv: 'DEFAULT_ORION_USER_AGENT',
  }),
  peerflix: basicPreset({
    label: 'Peerflix',
    default: ['https://addon.peerflix.mov'],
    envBase: 'PEERFLIX_URL',
    timeoutEnv: 'DEFAULT_PEERFLIX_TIMEOUT',
    userAgentEnv: 'DEFAULT_PEERFLIX_USER_AGENT',
  }),
  torbox: basicPreset({
    label: 'Torbox',
    default: ['https://stremio.torbox.app'],
    envBase: 'TORBOX_STREMIO_URL',
    timeoutEnv: 'DEFAULT_TORBOX_TIMEOUT',
    userAgentEnv: 'DEFAULT_TORBOX_USER_AGENT',
  }),
  easynews: basicPreset({
    label: 'Easynews',
    default: ['https://ea627ddf0ee7-easynews.baby-beamup.club'],
    envBase: 'EASYNEWS_URL',
    timeoutEnv: 'DEFAULT_EASYNEWS_TIMEOUT',
    userAgentEnv: 'DEFAULT_EASYNEWS_USER_AGENT',
  }),
  easynewsPlus: basicPreset({
    label: 'Easynews+',
    default: ['https://b89262c192b0-stremio-easynews-addon.baby-beamup.club'],
    envBase: 'EASYNEWS_PLUS_URL',
    timeoutEnv: 'DEFAULT_EASYNEWS_PLUS_TIMEOUT',
    userAgentEnv: 'DEFAULT_EASYNEWS_PLUS_USER_AGENT',
  }),
  easynewsPlusPlus: basicPreset({
    label: 'Easynews++',
    default: ['https://easynews-cloudflare-worker.jqrw92fchz.workers.dev'],
    envBase: 'EASYNEWS_PLUS_PLUS_URL',
    timeoutEnv: 'DEFAULT_EASYNEWS_PLUS_PLUS_TIMEOUT',
    userAgentEnv: 'DEFAULT_EASYNEWS_PLUS_PLUS_USER_AGENT',
    extras: {
      publicUrl: {
        schema: nullableUrl,
        default: null,
        label: 'Easynews++ public URL',
        description:
          'Public-facing URL surfaced to clients (when different from the internal one).',
        env: 'EASYNEWS_PLUS_PLUS_PUBLIC_URL',
        requiresRestart: false,
        secret: false,
      },
    },
  }),
  debridio: basicPreset({
    label: 'Debridio',
    default: ['https://addon.debridio.com'],
    envBase: 'DEBRIDIO_URL',
    timeoutEnv: 'DEFAULT_DEBRIDIO_TIMEOUT',
    userAgentEnv: 'DEFAULT_DEBRIDIO_USER_AGENT',
  }),
  debridioTvdb: basicPreset({
    label: 'Debridio TVDB',
    default: ['https://tvdb-addon.debridio.com'],
    envBase: 'DEBRIDIO_TVDB_URL',
    timeoutEnv: 'DEFAULT_DEBRIDIO_TVDB_TIMEOUT',
    userAgentEnv: 'DEFAULT_DEBRIDIO_TVDB_USER_AGENT',
  }),
  debridioTmdb: basicPreset({
    label: 'Debridio TMDB',
    default: ['https://tmdb-addon.debridio.com'],
    envBase: 'DEBRIDIO_TMDB_URL',
    timeoutEnv: 'DEFAULT_DEBRIDIO_TMDB_TIMEOUT',
    userAgentEnv: 'DEFAULT_DEBRIDIO_TMDB_USER_AGENT',
  }),
  debridioTv: basicPreset({
    label: 'Debridio TV',
    default: ['https://tv.lb.debridio.com'],
    envBase: 'DEBRIDIO_TV_URL',
    timeoutEnv: 'DEFAULT_DEBRIDIO_TV_TIMEOUT',
    userAgentEnv: 'DEFAULT_DEBRIDIO_TV_USER_AGENT',
  }),
  debridioWatchtower: basicPreset({
    label: 'Debridio Watchtower',
    default: ['https://wt-addon.debridio.com'],
    envBase: 'DEBRIDIO_WATCHTOWER_URL',
    timeoutEnv: 'DEFAULT_DEBRIDIO_WATCHTOWER_TIMEOUT',
    userAgentEnv: 'DEFAULT_DEBRIDIO_WATCHTOWER_USER_AGENT',
  }),
  debridioIc4a: basicPreset({
    label: 'Debridio IC4A',
    default: ['https://ic4a.lb.debridio.com'],
    envBase: 'DEBRIDIO_IC4A_URL',
    timeoutEnv: 'DEFAULT_DEBRIDIO_IC4A_TIMEOUT',
    userAgentEnv: 'DEFAULT_DEBRIDIO_IC4A_USER_AGENT',
  }),
  stremthruStore: basicPreset({
    label: 'StremThru Store',
    default: ['https://stremthru.13377001.xyz/stremio/store'],
    envBase: 'STREMTHRU_STORE_URL',
    timeoutEnv: 'DEFAULT_STREMTHRU_STORE_TIMEOUT',
    userAgentEnv: 'DEFAULT_STREMTHRU_STORE_USER_AGENT',
  }),
  stremthruTorz: basicPreset({
    label: 'StremThru Torz',
    default: ['https://stremthru.13377001.xyz/stremio/torz'],
    envBase: 'STREMTHRU_TORZ_URL',
    timeoutEnv: 'DEFAULT_STREMTHRU_TORZ_TIMEOUT',
    userAgentEnv: 'DEFAULT_STREMTHRU_TORZ_USER_AGENT',
  }),
  streamfusion: basicPreset({
    label: 'StreamFusion',
    default: ['https://stream-fusion.stremiofr.com'],
    envBase: 'DEFAULT_STREAMFUSION_URL',
    timeoutEnv: 'DEFAULT_STREAMFUSION_TIMEOUT',
    userAgentEnv: 'DEFAULT_STREAMFUSION_USER_AGENT',
  }),
  sootio: basicPreset({
    label: 'Sootio',
    default: ['https://sooti.click'],
    envBase: 'SOOTIO_URL',
    timeoutEnv: 'DEFAULT_SOOTIO_TIMEOUT',
    userAgentEnv: 'DEFAULT_SOOTIO_USER_AGENT',
  }),
  dmmCast: {
    defaultTimeout: timeoutField('DMM Cast', 'DEFAULT_DMM_CAST_TIMEOUT'),
    defaultUserAgent: userAgentField('DMM Cast', 'DEFAULT_DMM_CAST_USER_AGENT'),
  },
  opensubtitles: basicPreset({
    label: 'OpenSubtitles',
    default: ['https://opensubtitles-v3.strem.io'],
    envBase: 'OPENSUBTITLES_URL',
    timeoutEnv: 'DEFAULT_OPENSUBTITLES_TIMEOUT',
    userAgentEnv: 'DEFAULT_OPENSUBTITLES_USER_AGENT',
  }),
  opensubtitlesV3Plus: basicPreset({
    label: 'OpenSubtitles V3+',
    default: ['https://opensubtitles.stremio.homes'],
    envBase: 'OPENSUBTITLES_V3_PLUS_URL',
    timeoutEnv: 'DEFAULT_OPENSUBTITLES_V3_PLUS_TIMEOUT',
    userAgentEnv: 'DEFAULT_OPENSUBTITLES_V3_PLUS_USER_AGENT',
  }),
  marvelUniverse: basicPreset({
    label: 'Marvel Universe',
    default: ['https://addon-marvel.onrender.com'],
    envBase: 'MARVEL_UNIVERSE_URL',
    timeoutEnv: 'DEFAULT_MARVEL_CATALOG_TIMEOUT',
    userAgentEnv: 'DEFAULT_MARVEL_CATALOG_USER_AGENT',
  }),
  dcUniverse: basicPreset({
    label: 'DC Universe',
    default: ['https://addon-dc-cq85.onrender.com'],
    envBase: 'DC_UNIVERSE_URL',
    timeoutEnv: 'DEFAULT_DC_UNIVERSE_TIMEOUT',
    userAgentEnv: 'DEFAULT_DC_UNIVERSE_USER_AGENT',
  }),
  starWarsUniverse: basicPreset({
    label: 'Star Wars Universe',
    default: ['https://addon-star-wars-u9e3.onrender.com'],
    envBase: 'DEFAULT_STAR_WARS_UNIVERSE_URL',
    timeoutEnv: 'DEFAULT_STAR_WARS_UNIVERSE_TIMEOUT',
    userAgentEnv: 'DEFAULT_STAR_WARS_UNIVERSE_USER_AGENT',
  }),
  animeKitsu: basicPreset({
    label: 'Anime Kitsu',
    default: ['https://anime-kitsu.strem.fun'],
    envBase: 'ANIME_KITSU_URL',
    timeoutEnv: 'DEFAULT_ANIME_KITSU_TIMEOUT',
    userAgentEnv: 'DEFAULT_ANIME_KITSU_USER_AGENT',
  }),
  nuvioStreams: basicPreset({
    label: 'NuvioStreams',
    default: ['https://nuviostreams.hayd.uk'],
    envBase: 'NUVIOSTREAMS_URL',
    timeoutEnv: 'DEFAULT_NUVIOSTREAMS_TIMEOUT',
    userAgentEnv: 'DEFAULT_NUVIOSTREAMS_USER_AGENT',
  }),
  torrentCatalogs: basicPreset({
    label: 'Torrent Catalogs',
    default: ['https://torrent-catalogs.strem.fun'],
    envBase: 'TORRENT_CATALOGS_URL',
    timeoutEnv: 'DEFAULT_TORRENT_CATALOGS_TIMEOUT',
    userAgentEnv: 'DEFAULT_TORRENT_CATALOGS_USER_AGENT',
  }),
  tmdbCollections: basicPreset({
    label: 'TMDB Collections',
    default: ['https://61ab9c85a149-tmdb-collections.baby-beamup.club'],
    envBase: 'TMDB_COLLECTIONS_URL',
    timeoutEnv: 'DEFAULT_TMDB_COLLECTIONS_TIMEOUT',
    userAgentEnv: 'DEFAULT_TMDB_COLLECTIONS_USER_AGENT',
  }),
  rpdbCatalogs: basicPreset({
    label: 'RPDB Catalogs',
    default: ['https://1fe84bc728af-rpdb.baby-beamup.club'],
    envBase: 'RPDB_CATALOGS_URL',
    timeoutEnv: 'DEFAULT_RPDB_CATALOGS_TIMEOUT',
    userAgentEnv: 'DEFAULT_RPDB_CATALOGS_USER_AGENT',
  }),
  streamingCatalogs: basicPreset({
    label: 'Streaming Catalogs',
    default: [
      'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club',
    ],
    envBase: 'STREAMING_CATALOGS_URL',
    timeoutEnv: 'DEFAULT_STREAMING_CATALOGS_TIMEOUT',
    userAgentEnv: 'DEFAULT_STREAMING_CATALOGS_USER_AGENT',
  }),
  animeCatalogs: basicPreset({
    label: 'Anime Catalogs',
    default: ['https://1fe84bc728af-stremio-anime-catalogs.baby-beamup.club'],
    envBase: 'ANIME_CATALOGS_URL',
    timeoutEnv: 'DEFAULT_ANIME_CATALOGS_TIMEOUT',
    userAgentEnv: 'DEFAULT_ANIME_CATALOGS_USER_AGENT',
  }),
  doctorWhoUniverse: basicPreset({
    label: 'Doctor Who Universe',
    default: ['https://new-who.onrender.com'],
    envBase: 'DOCTOR_WHO_UNIVERSE_URL',
    timeoutEnv: 'DEFAULT_DOCTOR_WHO_UNIVERSE_TIMEOUT',
    userAgentEnv: 'DEFAULT_DOCTOR_WHO_UNIVERSE_USER_AGENT',
  }),
  webstreamr: basicPreset({
    label: 'WebStreamr',
    default: ['https://webstreamr.hayd.uk'],
    envBase: 'WEBSTREAMR_URL',
    timeoutEnv: 'DEFAULT_WEBSTREAMR_TIMEOUT',
    userAgentEnv: 'DEFAULT_WEBSTREAMR_USER_AGENT',
  }),
  hdhub: basicPreset({
    label: 'HdHub',
    default: ['https://hdhub.thevolecitor.qzz.io'],
    envBase: 'HDHUB_URL',
    timeoutEnv: 'DEFAULT_HDHUB_TIMEOUT',
    userAgentEnv: 'DEFAULT_HDHUB_USER_AGENT',
  }),
  baguettio: basicPreset({
    label: 'Baguettio',
    default: ['https://baguettio.org'],
    envBase: 'BAGUETTIO_URL',
    timeoutEnv: 'DEFAULT_BAGUETTIO_TIMEOUT',
    userAgentEnv: 'DEFAULT_BAGUETTIO_USER_AGENT',
  }),
  tmdbAddon: basicPreset({
    label: 'TMDB Addon',
    default: ['https://tmdb.elfhosted.com'],
    envBase: 'TMDB_ADDON_URL',
    timeoutEnv: 'DEFAULT_TMDB_ADDON_TIMEOUT',
    userAgentEnv: 'DEFAULT_TMDB_ADDON_USER_AGENT',
  }),
  torrentsDb: basicPreset({
    label: 'Torrents DB',
    default: ['https://torrentsdb.com'],
    envBase: 'TORRENTS_DB_URL',
    timeoutEnv: 'DEFAULT_TORRENTS_DB_TIMEOUT',
    userAgentEnv: 'DEFAULT_TORRENTS_DB_USER_AGENT',
  }),
  usaTv: basicPreset({
    label: 'USA TV',
    default: ['https://848b3516657c-usatv.baby-beamup.club'],
    envBase: 'USA_TV_URL',
    timeoutEnv: 'DEFAULT_USA_TV_TIMEOUT',
    userAgentEnv: 'DEFAULT_USA_TV_USER_AGENT',
  }),
  argentinaTv: basicPreset({
    label: 'Argentina TV',
    default: ['https://848b3516657c-argentinatv.baby-beamup.club'],
    envBase: 'ARGENTINA_TV_URL',
    timeoutEnv: 'DEFAULT_ARGENTINA_TV_TIMEOUT',
    userAgentEnv: 'DEFAULT_ARGENTINA_TV_USER_AGENT',
  }),
  brazucaTorrents: basicPreset({
    label: 'Brazuca Torrents',
    default: ['https://94c8cb9f702d-brazuca-torrents.baby-beamup.club'],
    envBase: 'BRAZUCA_TORRENTS_URL',
    timeoutEnv: 'DEFAULT_BRAZUCA_TORRENTS_TIMEOUT',
    userAgentEnv: 'DEFAULT_BRAZUCA_TORRENTS_USER_AGENT',
  }),
  subdl: basicPreset({
    label: 'SubDL',
    default: ['https://subdl.strem.top'],
    envBase: 'SUBDL_URL',
    timeoutEnv: 'DEFAULT_SUBDL_TIMEOUT',
    userAgentEnv: 'DEFAULT_SUBDL_USER_AGENT',
  }),
  subsource: basicPreset({
    label: 'SubSource',
    default: ['https://subsource.strem.top'],
    envBase: 'SUBSOURCE_URL',
    timeoutEnv: 'DEFAULT_SUBSOURCE_TIMEOUT',
    userAgentEnv: 'DEFAULT_SUBSOURCE_USER_AGENT',
  }),
  aiSearch: basicPreset({
    label: 'AI Search',
    default: ['https://stremio.itcon.au'],
    envBase: 'AI_SEARCH_URL',
    timeoutEnv: 'DEFAULT_AI_SEARCH_TIMEOUT',
    userAgentEnv: 'DEFAULT_AI_SEARCH_USER_AGENT',
  }),
  flixStreams: basicPreset({
    label: 'Flix-Streams',
    default: ['https://flixnest.app/flix-streams'],
    envBase: 'FLIX_STREAMS_URL',
    timeoutEnv: 'DEFAULT_FLIX_STREAMS_TIMEOUT',
    userAgentEnv: 'DEFAULT_FLIX_STREAMS_USER_AGENT',
  }),
  fkstream: basicPreset({
    label: 'FKStream',
    default: ['https://streamio.fankai.fr'],
    envBase: 'FKSTREAM_URL',
    timeoutEnv: 'DEFAULT_FKSTREAM_TIMEOUT',
    userAgentEnv: 'DEFAULT_FKSTREAM_USER_AGENT',
  }),
  aioSubtitle: basicPreset({
    label: 'AIOSubtitle',
    default: ['https://3b4bbf5252c4-aio-streaming.baby-beamup.club'],
    envBase: 'AIOSUBTITLE_URL',
    timeoutEnv: 'DEFAULT_AIOSUBTITLE_TIMEOUT',
    userAgentEnv: 'DEFAULT_AIOSUBTITLE_USER_AGENT',
  }),
  subhero: basicPreset({
    label: 'SubHero',
    default: ['https://subhero.chromeknight.dev'],
    envBase: 'SUBHERO_URL',
    timeoutEnv: 'DEFAULT_SUBHERO_TIMEOUT',
    userAgentEnv: 'DEFAULT_SUBHERO_USER_AGENT',
  }),
  yastream: basicPreset({
    label: 'yastream',
    default: ['https://yastream.tamthai.de'],
    envBase: 'YASTREAM_URL',
    timeoutEnv: 'DEFAULT_YASTREAM_TIMEOUT',
    userAgentEnv: 'DEFAULT_YASTREAM_USER_AGENT',
  }),
  streamasia: basicPreset({
    label: 'StreamAsia',
    default: ['https://stremio-dramacool-addon.xyz'],
    envBase: 'STREAMASIA_URL',
    timeoutEnv: 'DEFAULT_STREAMASIA_TIMEOUT',
    userAgentEnv: 'DEFAULT_STREAMASIA_USER_AGENT',
  }),
  moreLikeThis: basicPreset({
    label: 'More Like This',
    default: ['https://bbab4a35b833-more-like-this.baby-beamup.club'],
    envBase: 'MORE_LIKE_THIS_URL',
    timeoutEnv: 'DEFAULT_MORE_LIKE_THIS_TIMEOUT',
    userAgentEnv: 'DEFAULT_MORE_LIKE_THIS_USER_AGENT',
  }),
  contentDeepDive: basicPreset({
    label: 'Content Deep Dive',
    default: [
      'https://stremio-content-deepdive-addon-dc8f7b513289.herokuapp.com',
    ],
    envBase: 'CONTENT_DEEP_DIVE_URL',
    timeoutEnv: 'DEFAULT_CONTENT_DEEP_DIVE_TIMEOUT',
    userAgentEnv: 'DEFAULT_CONTENT_DEEP_DIVE_USER_AGENT',
  }),
  aiCompanion: basicPreset({
    label: 'AI Companion',
    default: ['https://ai-companion.saladprecedestretch123.uk'],
    envBase: 'AI_COMPANION_URL',
    timeoutEnv: 'DEFAULT_AI_COMPANION_TIMEOUT',
    userAgentEnv: 'DEFAULT_AI_COMPANION_USER_AGENT',
  }),
  astream: basicPreset({
    label: 'AStream',
    default: ['https://astream.stremiofr.com'],
    envBase: 'ASTREAM_URL',
    timeoutEnv: 'DEFAULT_ASTREAM_TIMEOUT',
    userAgentEnv: 'DEFAULT_ASTREAM_USER_AGENT',
  }),
} satisfies RuntimeConfigSection;
