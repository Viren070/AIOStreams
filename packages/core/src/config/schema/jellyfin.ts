import { z } from 'zod';
import * as constants from '../../utils/constants.js';
import { seconds, byteSize } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/**
 * The Jellyfin-compatible API: every configuration presented as a Jellyfin
 * server under /jellyfin. Direct play only, nothing is transcoded.
 */
export const jellyfinSchema = {
  enabled: {
    schema: z.boolean(),
    default: true,
    label: 'Enable Jellyfin API',
    description:
      'Presents every configuration as a Jellyfin server at /jellyfin. Clients sign in with the configuration UUID or alias and its password, approve a Quick Connect code from the configuration page, or use the pre-authenticated /jellyfin/<uuid>/<encryptedPassword> address.',
    env: 'JELLYFIN_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  version: {
    schema: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'Must be a dotted numeric version like 12.0.0'),
    default: '12.0.0',
    label: 'Reported server version',
    description:
      'Version returned by /System/Info. Clients parse it as numbers, so keep the dotted numeric form; lower it (for example 10.11.9) only if a client misbehaves with the current release.',
    env: 'JELLYFIN_VERSION',
    requiresRestart: false,
    secret: false,
  },
  imageDelivery: {
    schema: z.enum(['redirect', 'relay', 'never-relay']),
    default: 'redirect',
    label: 'Image delivery',
    description:
      '**redirect** answers artwork requests with a 302 to the image URL so no image bytes pass through this server; **relay** fetches and pipes every image; **never-relay** redirects even the clients that need a relay. Infuse does not follow image redirects, so it receives a relay under **redirect** and blank artwork under **never-relay**.',
    env: 'JELLYFIN_IMAGE_DELIVERY',
    requiresRestart: false,
    secret: false,
  },
  imageMaxRelayBytes: {
    schema: byteSize,
    default: 3 * 1000 * 1000,
    label: 'Largest relayed image',
    description:
      'Images bigger than this are redirected to instead of being piped through the server. Relayed artwork is already asked for at display size, so anything above this is an image that ignored that.',
    env: 'JELLYFIN_IMAGE_MAX_RELAY_BYTES',
    requiresRestart: false,
    secret: false,
    ui: { min: 1024 },
  },
  imageRelayConcurrency: {
    schema: z.number().int().min(1).max(512),
    default: 32,
    label: 'Concurrent image relays',
    description:
      'How many images this server pipes at once. A cold home screen asks for every poster at the same time, and each relay in flight holds a connection open; requests over the limit are redirected instead of queued.',
    env: 'JELLYFIN_IMAGE_RELAY_CONCURRENCY',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: 512 },
  },
  maxCatalogItems: {
    schema: z.number().int().min(0),
    default: 250,
    label: 'Max items per library',
    description:
      'How deep a Jellyfin client may page into one catalog. Library crawlers (Infuse sync, Kodi) walk every library to this cap, and each addon page of 20 items is one upstream request, so 250 costs at most ~13 requests per library and keeps a whole configuration inside the catalog cache. 0 disables the cap.',
    env: 'JELLYFIN_MAX_CATALOG_ITEMS',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
  maxLibraries: {
    schema: z.number().int().min(0),
    default: 20,
    label: 'Max libraries per configuration',
    description:
      "How many of a configuration's catalogs appear as Jellyfin libraries, in the configuration's own catalog order. Most Jellyfin apps load every library's latest row at once when the home screen opens, so each library is another upstream request on every visit. Catalogs past the limit are not shown as libraries. 0 shows them all.",
    env: 'JELLYFIN_MAX_LIBRARIES',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
  upcomingDays: {
    schema: z.number().int().min(1).max(365),
    default: 14,
    label: 'Upcoming window (days)',
    description:
      'How far ahead the Upcoming row looks for episodes of shows you are part way through. A library only holds what exists, so Jellyfin itself needs no window, but metadata addons announce episodes months out and the row becomes a schedule rather than a shelf.',
    env: 'JELLYFIN_UPCOMING_DAYS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: 365 },
  },
  maxVersions: {
    schema: z.number().int().min(1).max(50),
    default: 10,
    label: 'Max versions per item',
    description:
      'Upper bound on how many streams an item offers as versions. Configurations can pick a lower number.',
    env: 'JELLYFIN_MAX_VERSIONS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1, max: 50 },
  },
  maxPersonas: {
    schema: z.number().int().min(0).max(100),
    default: 20,
    label: 'Max users per configuration',
    description:
      'How many extra users a configuration may offer its Jellyfin clients, on top of its own primary user. Each one is a name a client can sign in as, with its own watch history and variants, and all of them share the configuration password, so they separate households rather than secure them. 0 leaves only the primary user.',
    env: 'JELLYFIN_MAX_PERSONAS',
    requiresRestart: false,
    secret: false,
    ui: { min: 0, max: 100 },
  },
  resolveOnOpen: {
    schema: z.enum(['always', 'never', 'user']),
    default: 'user',
    label: 'Resolve streams when an item is opened',
    description:
      'Stock clients build their version picker from the item page, which means fetching streams before playback starts. **always** does that for everyone, **never** only resolves on play (the picker shows a placeholder until then), **user** lets each configuration choose.',
    env: 'JELLYFIN_RESOLVE_ON_OPEN',
    requiresRestart: false,
    secret: false,
  },
  segments: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'Skip intro and credits',
      description:
        "Offers clients intro, recap and credits markers so they can show a skip button. It sends the id, season and episode of everything played to the providers below, so turn it off if that should stay private. Timestamps are submitted against one release of an episode and yours may be cut differently, so a marker can be seconds out; whether a client skips automatically or asks first is that client's own setting, not ours.",
      env: 'JELLYFIN_SEGMENTS_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    providers: {
      schema: z.array(z.enum(constants.SEGMENT_PROVIDERS)),
      default: ['introdb', 'aniskip', 'pmdb'] as string[],
      label: 'Segment providers',
      description:
        'Which databases to ask, best first. They are all asked at once, and for each marker type the highest one on this list that has it wins. **introdb** is IMDb-keyed and covers every series, plus end credits for movies; **aniskip** is anime only and is the one provider that matches submissions against the real episode length; **animeskip** is anime only, needs a client id, and costs a whole-show fetch per episode; **pmdb** (PublicMetaDB) covers movies as well as series, and needs an API key from the instance or from each configuration, so it is skipped for a configuration that has neither.',
      env: 'JELLYFIN_SEGMENTS_PROVIDERS',
      requiresRestart: false,
      secret: false,
      ui: { orderable: true },
    },
    animeSkipClientId: {
      schema: z.string(),
      default: '',
      label: 'Anime Skip client id',
      description:
        'Anime Skip refuses requests without one and its public shared id is heavily rate limited, so get your own from an Anime Skip account. Leaving this empty disables that provider however it is ordered.',
      env: 'JELLYFIN_SEGMENTS_ANIME_SKIP_CLIENT_ID',
      requiresRestart: false,
      secret: true,
    },
    pmdbApiKey: {
      schema: z.string(),
      default: '',
      label: 'PublicMetaDB API key',
      description:
        "Used for every configuration that has not entered its own key. PublicMetaDB rate limits by IP rather than by key, so a configuration's own key buys no extra headroom; it only means that configuration's lookups are made as its own account instead of yours. Leave this empty to offer PublicMetaDB only to configurations that bring a key.",
      env: 'JELLYFIN_SEGMENTS_PMDB_API_KEY',
      requiresRestart: false,
      secret: true,
    },
    baseUrls: {
      schema: z.partialRecord(z.enum(constants.SEGMENT_PROVIDERS), z.string()),
      default: {} as Record<string, string>,
      label: 'Provider URL overrides',
      description:
        'Point a provider at a mirror or your own instance, keyed by provider id. Anything left out uses the public endpoint.',
      env: 'JELLYFIN_SEGMENTS_BASE_URLS',
      requiresRestart: false,
      secret: false,
    },
    ttl: {
      schema: seconds,
      default: 7 * 24 * 3600,
      label: 'Cache markers for',
      description:
        'How long a set of markers is reused (accepts e.g. "7d", "12h"). They only change when somebody submits a correction, so this can be days.',
      env: 'JELLYFIN_SEGMENTS_TTL',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'duration' },
    },
    negativeTtl: {
      schema: seconds,
      default: 24 * 3600,
      label: 'Cache "nothing found" for',
      description:
        'Most episodes are in none of these databases, and IntroDB answers a show it has never heard of with an empty result rather than an error, so misses have to be remembered or every episode of an uncovered series asks again on every play.',
      env: 'JELLYFIN_SEGMENTS_NEGATIVE_TTL',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'duration' },
    },
    timeout: {
      schema: seconds,
      default: 5,
      label: 'Provider timeout',
      description:
        'How long to wait for one provider. Providers are asked in parallel, so this bounds the whole lookup rather than each one adding up. A lookup stops waiting once the providers higher on the list have the markers asked for, but some apps wait for markers before they start playing, so a provider that has to time out can delay playback by this much.',
      env: 'JELLYFIN_SEGMENTS_TIMEOUT',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'duration' },
    },
    minConfidence: {
      schema: z.number().min(0).max(1),
      default: 0,
      label: 'Minimum confidence',
      description:
        'Drop markers a provider scores below this, where it publishes a score at all (IntroDB does). It measures how far submitters agree with each other, not how well they match your file.',
      env: 'JELLYFIN_SEGMENTS_MIN_CONFIDENCE',
      requiresRestart: false,
      secret: false,
      ui: { min: 0, max: 1, step: 0.05 },
    },
    minSubmissions: {
      schema: z.number().int().min(0),
      default: 0,
      label: 'Minimum submissions',
      description:
        'Drop markers backed by fewer submissions than this. Raising it to 2 discards everything only one person has ever timed, which is most of the long tail.',
      env: 'JELLYFIN_SEGMENTS_MIN_SUBMISSIONS',
      requiresRestart: false,
      secret: false,
      ui: { min: 0 },
    },
  },
  streamCacheTtl: {
    schema: seconds,
    default: 180,
    label: 'Reuse resolved streams for (seconds)',
    description:
      "How long an item's resolved streams are reused before the pipeline runs again. It keeps opening an item and then playing it to a single run, while staying short enough that debrid cached/uncached status is current. Saving a configuration resolves again as soon as the change is picked up, within 30 seconds, however long this is set to. 0 resolves on every request, which is the most current and the most expensive.",
    env: 'JELLYFIN_STREAM_CACHE_TTL',
    requiresRestart: false,
    secret: false,
    ui: { min: 0 },
  },
} as const satisfies RuntimeConfigSection;
