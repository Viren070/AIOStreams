import bytes from 'bytes';
import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  PresetMetadata,
  Stream,
  UserData,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';
import { config as appConfig } from '../config/index.js';
import {
  constants,
  createLogger,
  makeRequest,
  ServiceId,
} from '../utils/index.js';
import { baseOptions, Preset, StreamResponseHookOptions } from './preset.js';
import {
  filterTorrentClawPlaybackActions,
  getTorrentClawCachedStatus,
  streamText,
  type TorrentClawPlaybackOptions,
} from './torrentclaw-cache.js';

type TorrentClawFormattingOptions = {
  useAioFormatter?: boolean;
  showEpisodeAndPackSizes?: boolean;
  showScore?: boolean;
  showTorBoxIndicator?: boolean;
  showTrueSpec?: boolean;
};

type TorrentClawRemappingOptions = {
  enabled?: boolean;
  mode?: 'fallback' | 'merge';
  titleMatch?: 'exact' | 'contains';
  yearTolerance?: string | number;
  searchLimit?: number;
  positiveCacheMinutes?: number;
  negativeCacheMinutes?: number;
};

type TorrentClawPresetOptions = {
  playback?: TorrentClawPlaybackOptions;
  remapping?: TorrentClawRemappingOptions;
  formatting?: TorrentClawFormattingOptions;
};

type RemapCacheEntry = {
  value: string[] | null;
  expires: number;
};

const logger = createLogger('torrentclaw');
const remapCache = new Map<string, RemapCacheEntry>();
const episodeSizeCache = new Map<
  string,
  { value: number | null; expires: number }
>();

function parseByteValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value !== 'string') return undefined;
  const parsed = bytes.parse(value);
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : undefined;
}

function getTorrentClawReportedSize(stream: Stream): number | undefined {
  const hinted =
    parseByteValue(stream.behaviorHints?.folderSize) ||
    parseByteValue(stream.behaviorHints?.videoSize);
  if (hinted) return hinted;

  const text = `${stream.description || ''}\n${stream.title || ''}`;
  const matches = text.match(
    /\b\d+(?:\.\d+)?\s*(?:TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\b/gi
  );
  for (const match of matches || []) {
    const parsed = parseByteValue(match);
    if (parsed) return parsed;
  }
}

function isTorrentClawSeasonPack(stream: Stream): boolean {
  const filename = String(stream.behaviorHints?.filename || '');
  if (!filename) return false;

  const hasEpisode = /\bS\d{1,2}\s*E\d{1,3}\b/i.test(filename);
  return (
    /\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b/i.test(filename) ||
    /\bS\d{1,2}\s*E\d{1,3}\s*[-–]\s*(?:(?:S\d{1,2}\s*)?E)?\d{1,3}\b/i.test(
      filename
    ) ||
    /\b\d{1,2}x\d{1,3}\s*[-–]\s*\d{1,3}\b/i.test(filename) ||
    /\b(?:complete|collection|season(?:s)?|temporada)\b/i.test(filename) ||
    /\b(?:сезон|серии)\b/iu.test(filename) ||
    (!hasEpisode && /(?:^|[[(\s])S\d{1,2}(?=$|[\])\s])/i.test(filename))
  );
}

async function probeEpisodeSize(url: string): Promise<number | undefined> {
  const cached = episodeSizeCache.get(url);
  if (cached && cached.expires > Date.now()) {
    return cached.value ?? undefined;
  }

  let value: number | undefined;
  try {
    const response = await makeRequest(url, {
      method: 'HEAD',
      timeout: 8_000,
      headers: {
        'User-Agent': 'AIOStreams TorrentClaw episode-size probe',
      },
    });
    if (response.ok) {
      value = parseByteValue(response.headers.get('content-length'));
    }
  } catch {
    // Size enrichment is best-effort and must never hide a playable stream.
  }

  if (episodeSizeCache.size > 2_000) {
    const now = Date.now();
    for (const [key, entry] of episodeSizeCache) {
      if (entry.expires <= now) episodeSizeCache.delete(key);
    }
  }
  episodeSizeCache.set(url, {
    value: value ?? null,
    expires: Date.now() + (value ? 15 : 2) * 60 * 1000,
  });
  return value;
}

async function enrichSeasonPackSizes(
  streams: Stream[],
  type: string,
  formatting: TorrentClawFormattingOptions
): Promise<Stream[]> {
  if (type !== 'series' || formatting.showEpisodeAndPackSizes === false) {
    return streams;
  }

  const candidates = streams
    .map((stream, index) => ({ stream, index }))
    .filter(
      ({ stream }) =>
        Boolean(stream.url) &&
        isTorrentClawSeasonPack(stream) &&
        Boolean(getTorrentClawReportedSize(stream))
    )
    .slice(0, 48);
  if (!candidates.length) return streams;

  const enriched = [...streams];
  let enrichedCount = 0;
  for (let offset = 0; offset < candidates.length; offset += 6) {
    const batch = candidates.slice(offset, offset + 6);
    await Promise.all(
      batch.map(async ({ stream, index }) => {
        const packSize = getTorrentClawReportedSize(stream);
        const episodeSize = stream.url
          ? await probeEpisodeSize(stream.url)
          : undefined;
        if (!packSize || !episodeSize || packSize <= episodeSize * 1.05) {
          return;
        }

        enriched[index] = {
          ...stream,
          behaviorHints: {
            ...(stream.behaviorHints || {}),
            videoSize: episodeSize,
            folderSize: packSize,
          },
        };
        enrichedCount += 1;
      })
    );
  }
  if (enrichedCount) {
    logger.debug(
      { enrichedCount, candidateCount: candidates.length },
      'enriched TorrentClaw season packs with episode and folder sizes'
    );
  }
  return enriched;
}

function normaliseTitle(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractYear(value: unknown): number | null {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function numberInRange(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

function hasPlayableStream(streams: Stream[]): boolean {
  return streams.some((stream) => Boolean(stream.url));
}

function mergeStreams(original: Stream[], additions: Stream[][]): Stream[] {
  const seen = new Set<string>();
  return [...original, ...additions.flat()].filter((stream) => {
    const key =
      stream.url ||
      stream.externalUrl ||
      `${stream.name || ''}\n${stream.title || ''}\n${stream.description || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJson(url: string): Promise<any> {
  const response = await makeRequest(url, {
    timeout: 20_000,
    headers: {
      'User-Agent': 'AIOStreams native TorrentClaw metadata remapper',
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} - ${response.statusText}`);
  }
  return response.json();
}

async function discoverTorrentClawIds(
  type: string,
  requestedId: string,
  remapping: TorrentClawRemappingOptions
): Promise<string[] | null> {
  if (!/^tt\d+$/i.test(requestedId)) return null;

  const titleMatch = remapping.titleMatch === 'contains' ? 'contains' : 'exact';
  const yearTolerance = numberInRange(remapping.yearTolerance, 1, 0, 5);
  const searchLimit = numberInRange(remapping.searchLimit, 10, 1, 25);
  const cacheKey = [
    type,
    requestedId,
    titleMatch,
    yearTolerance,
    searchLimit,
  ].join(':');
  const cached = remapCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const metadataUrl = new URL(
    `/meta/${type}/${requestedId}.json`,
    'https://v3-cinemeta.strem.io'
  );
  const metadata = (await fetchJson(metadataUrl.toString()))?.meta;
  if (!metadata?.name) return null;

  const expectedTitle = normaliseTitle(metadata.name);
  const expectedYear = extractYear(metadata.year || metadata.releaseInfo);
  const searchUrl = new URL('https://torrentclaw.com/api/v1/search');
  searchUrl.searchParams.set('q', metadata.name);
  searchUrl.searchParams.set('limit', String(searchLimit));
  const searchPayload = await fetchJson(searchUrl.toString());
  const candidates = Array.isArray(searchPayload?.results)
    ? searchPayload.results
    : [];

  const ranked = candidates
    .map((item: any) => {
      const matchesTitle = [item?.title, item?.originalTitle]
        .map(normaliseTitle)
        .some((candidateTitle) =>
          titleMatch === 'contains'
            ? candidateTitle.length >= 4 &&
              (candidateTitle.includes(expectedTitle) ||
                expectedTitle.includes(candidateTitle))
            : candidateTitle === expectedTitle
        );
      const candidateYear = extractYear(item?.year);
      const yearDelta =
        expectedYear && candidateYear
          ? Math.abs(expectedYear - candidateYear)
          : null;
      const yearScore = !expectedYear
        ? 30
        : yearDelta === 0
          ? 30
          : yearDelta !== null && yearDelta <= yearTolerance
            ? 10
            : 0;
      return {
        id: item?.imdbId,
        score: (matchesTitle ? 100 : 0) + yearScore,
        yearDelta,
      };
    })
    .filter(
      (item: { id?: string; score: number; yearDelta: number | null }) =>
        /^tt\d+$/i.test(item.id || '') &&
        item.id !== requestedId &&
        item.score >= 110 &&
        (!expectedYear ||
          (item.yearDelta !== null && item.yearDelta <= yearTolerance))
    )
    .sort(
      (left: { score: number }, right: { score: number }) =>
        right.score - left.score
    );

  let value: string[] | null = null;
  if (ranked.length) {
    const ids: string[] = ranked.map((item: { id?: string }) =>
      String(item.id)
    );
    value = Array.from(new Set<string>(ids));
  }
  const cacheMinutes = value
    ? numberInRange(remapping.positiveCacheMinutes, 360, 1, 1440)
    : numberInRange(remapping.negativeCacheMinutes, 10, 1, 120);
  remapCache.set(cacheKey, {
    value,
    expires: Date.now() + cacheMinutes * 60 * 1000,
  });
  return value;
}

export class TorrentClawStreamParser extends StreamParser {
  private get options(): TorrentClawFormattingOptions {
    return (this.addon.preset?.options?.formatting ||
      {}) as TorrentClawFormattingOptions;
  }

  private getLines(stream: Stream): string[] {
    return String(stream.description || stream.title || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  protected override getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    const text = streamText(stream);
    const providers: Array<{ id: ServiceId; pattern: RegExp }> = [
      {
        id: constants.REALDEBRID_SERVICE,
        pattern: /(?:^|[\s·|[(])(?:RD|REAL[- ]?DEBRID)(?=$|[\s·|)\]])/i,
      },
      {
        id: constants.ALLDEBRID_SERVICE,
        pattern: /(?:^|[\s·|[(])(?:AD|ALL[- ]?DEBRID)(?=$|[\s·|)\]])/i,
      },
      {
        id: constants.TORBOX_SERVICE,
        pattern: /(?:^|[\s·|[(])(?:TB|TORBOX)(?=$|[\s·|)\]])/i,
      },
      {
        id: constants.PREMIUMIZE_SERVICE,
        pattern: /(?:^|[\s·|[(])(?:PM|PREMIUMIZE)(?=$|[\s·|)\]])/i,
      },
    ];
    const provider = providers.find(({ pattern }) => pattern.test(text));
    if (!provider) return super.getService(stream, currentParsedStream);
    return {
      id: provider.id,
      cached: getTorrentClawCachedStatus(stream),
    };
  }

  protected override getIndexer(): string {
    return 'TorrentClaw';
  }

  protected override getResolution(stream: Stream): string | undefined {
    return stream.name?.match(/\b(2160p|1080p|720p|576p|480p|360p)\b/i)?.[1];
  }

  protected override getReleaseGroup(stream: Stream): string | undefined {
    return this.getLines(stream)
      .find((line) => /🏷️?/.test(line))
      ?.replace(/^.*?🏷️?\s*/u, '')
      .trim();
  }

  protected override getParsedFileMergeOverrides(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): Partial<ParsedFile> {
    const flags = this.getLines(stream)
      .join(' ')
      .match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu);
    const languages = flags
      ?.map((flag) => this.convertFlagToLanguage(flag))
      .filter((language): language is string => Boolean(language));

    return languages?.length ? { languages: [...new Set(languages)] } : {};
  }

  protected override getExtras(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['extra'] {
    const lines = this.getLines(stream);
    const score = lines.find((line) => /\b\d{1,3}\/100\b/.test(line));
    const trueSpec = lines.find((line) => /\btruespec\b/i.test(line));
    const isAction = !stream.url && Boolean(stream.externalUrl);
    const suffix: string[] = [];

    if (this.options.showScore !== false && score) {
      suffix.push(
        this.options.showTorBoxIndicator === false
          ? score.replace(/\s*·\s*TB\b/gi, '').trim()
          : score
      );
    }
    if (this.options.showTrueSpec !== false && trueSpec) suffix.push(trueSpec);

    return {
      ...(super.getExtras(stream, currentParsedStream) || {}),
      torrentClaw: {
        score: score?.match(/\b(\d{1,3})\/100\b/)?.[1]
          ? Number(score.match(/\b(\d{1,3})\/100\b/)?.[1])
          : undefined,
        torBox: /\bTB\b/.test(score || ''),
        trueSpec: Boolean(trueSpec),
      },
      formattingPassthrough: isAction,
      formattingSuffix: suffix,
    };
  }
}

export class TorrentClawPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return TorrentClawStreamParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.PREMIUMIZE_SERVICE,
    ];
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'TorrentClaw',
        supportedResources,
        appConfig.presets.torrentclaw.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        appConfig.presets.torrentclaw.url
      ),
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits TorrentClaw to selected media types. Leave empty for movies and series.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: [],
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
      },
      {
        id: 'playback',
        name: 'Playback Sources',
        description: 'Choose which TorrentClaw action cards are shown.',
        type: 'subsection',
        subsectionIntent: 'pill',
        subOptions: [
          {
            id: 'watchInBrowser',
            name: 'Watch in Browser',
            description:
              'Show TorrentClaw’s external browser-player source card.',
            type: 'boolean',
            default: false,
          },
          {
            id: 'downloadActions',
            name: 'Download / Cache-on-play',
            description:
              'Send non-instant results through AIOStreams as uncached streams so normal cached/uncached filtering and sorting apply.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'unavailableNotices',
            name: 'Unavailable Notices',
            description:
              'Show TorrentClaw’s “no instant streams” informational card.',
            type: 'boolean',
            default: false,
          },
        ],
      },
      {
        id: 'remapping',
        name: 'Metadata Remapping',
        description:
          'Repair IMDb IDs when TorrentClaw has a title indexed under a different ID.',
        type: 'subsection',
        subsectionIntent: 'pill',
        subOptions: [
          {
            id: 'enabled',
            name: 'Automatic Remapping',
            description:
              'Use Cinemeta title/year metadata and TorrentClaw search when IDs do not return playable streams.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'mode',
            name: 'Remap Mode',
            description:
              'Fallback only remaps empty results. Merge also checks alternate IDs when the requested ID works.',
            type: 'select',
            default: 'fallback',
            options: [
              { label: 'Fallback when empty', value: 'fallback' },
              { label: 'Merge alternate IDs', value: 'merge' },
            ],
          },
          {
            id: 'titleMatch',
            name: 'Title Matching',
            description:
              'Exact is safest. Normalized contains can repair more aliases while still enforcing the year limit.',
            type: 'select',
            default: 'exact',
            options: [
              { label: 'Exact normalized title', value: 'exact' },
              { label: 'Normalized contains', value: 'contains' },
            ],
          },
          {
            id: 'yearTolerance',
            name: 'Year Tolerance',
            description:
              'Maximum release-year difference allowed for an automatic match.',
            type: 'select',
            default: '1',
            options: [
              { label: 'Same year only', value: '0' },
              { label: '1 year', value: '1' },
              { label: '2 years', value: '2' },
              { label: '3 years', value: '3' },
              { label: '5 years', value: '5' },
            ],
          },
          {
            id: 'searchLimit',
            name: 'Search Result Limit',
            description: 'Maximum TorrentClaw search candidates to inspect.',
            type: 'number',
            default: 10,
            constraints: { min: 1, max: 25, forceInUi: true },
            showInSimpleMode: false,
          },
          {
            id: 'positiveCacheMinutes',
            name: 'Successful Match Cache (minutes)',
            description: 'How long successful ID mappings are cached.',
            type: 'number',
            default: 360,
            constraints: { min: 1, max: 1440, forceInUi: true },
            showInSimpleMode: false,
          },
          {
            id: 'negativeCacheMinutes',
            name: 'No-match Cache (minutes)',
            description: 'How long unsuccessful mapping searches are cached.',
            type: 'number',
            default: 10,
            constraints: { min: 1, max: 120, forceInUi: true },
            showInSimpleMode: false,
          },
        ],
      },
      {
        id: 'formatting',
        name: 'Formatting Compatibility',
        description:
          'Use AIOStreams formatting while preserving TorrentClaw-specific verification data.',
        type: 'subsection',
        subsectionIntent: 'pill',
        subOptions: [
          {
            id: 'useAioFormatter',
            name: 'Use AIOStreams Formatter',
            description:
              'Apply your normal AIOStreams formatter to playable TorrentClaw sources.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showEpisodeAndPackSizes',
            name: 'Episode + Season Pack Sizes',
            description:
              'For season packs, show the selected episode size and full pack size, and calculate bitrate from the episode size.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showScore',
            name: 'TorrentClaw Score',
            description: 'Preserve TorrentClaw’s quality score indicator.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showTorBoxIndicator',
            name: 'TorBox Indicator',
            description:
              'Keep the TB provider badge beside TorrentClaw scores.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showTrueSpec',
            name: 'TrueSpec Indicator',
            description: 'Preserve the TrueSpec Verified indicator.',
            type: 'boolean',
            default: true,
          },
        ],
      },
      {
        id: 'pinPosition',
        name: 'Pin Position',
        description: 'Optionally pin TorrentClaw sources in the final list.',
        type: 'select',
        required: false,
        default: undefined,
        options: [
          { label: 'None', value: undefined },
          { label: 'Top', value: 'top' },
          { label: 'Bottom', value: 'bottom' },
        ],
        showInSimpleMode: false,
      },
      {
        id: 'resultPassthrough',
        name: 'Always Keep Results',
        description:
          'Prevent TorrentClaw results from being removed by final result filtering.',
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [{ id: 'website', url: 'https://torrentclaw.com' }],
      },
    ];

    return {
      ID: 'torrentclaw',
      NAME: 'TorrentClaw',
      LOGO: 'https://torrentclaw.com/icon-512.png',
      URL: appConfig.presets.torrentclaw.url,
      TIMEOUT:
        appConfig.presets.torrentclaw.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.torrentclaw.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'AI-verified torrent and debrid streams with quality scores, TrueSpec indicators, and automatic metadata-ID repair.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
        constants.EXTERNAL_STREAM_TYPE,
        constants.STREMIO_USENET_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  static override async transformStreamResponse({
    addon,
    type,
    id,
    streams,
    fetchStreams,
  }: StreamResponseHookOptions): Promise<Stream[]> {
    const options = (addon.preset.options || {}) as TorrentClawPresetOptions;
    const playback = options.playback || {};
    const remapping = options.remapping || {};
    const original = filterTorrentClawPlaybackActions(streams, playback).filter(
      (stream) => stream.type !== constants.STREMIO_USENET_STREAM_TYPE
    );

    if (remapping.enabled === false || !/^tt\d+/i.test(id)) {
      return enrichSeasonPackSizes(original, type, options.formatting || {});
    }
    if (remapping.mode !== 'merge' && hasPlayableStream(original)) {
      return enrichSeasonPackSizes(original, type, options.formatting || {});
    }

    const parts = id.split(':');
    const requestedId = parts[0];
    try {
      const alternatives = await discoverTorrentClawIds(
        type,
        requestedId,
        remapping
      );
      const additions: Stream[][] = [];
      for (const alternativeId of (alternatives || []).slice(0, 3)) {
        const replacementParts = [...parts];
        replacementParts[0] = alternativeId;
        const retry = filterTorrentClawPlaybackActions(
          await fetchStreams(replacementParts.join(':')),
          playback
        );
        if (!hasPlayableStream(retry)) continue;
        logger.info(
          { type, requestedId, replacementId: alternativeId },
          'resolved TorrentClaw metadata mismatch natively'
        );
        if (remapping.mode !== 'merge') {
          return enrichSeasonPackSizes(retry, type, options.formatting || {});
        }
        additions.push(retry);
      }
      return enrichSeasonPackSizes(
        additions.length ? mergeStreams(original, additions) : original,
        type,
        options.formatting || {}
      );
    } catch (error) {
      logger.warn(
        {
          type,
          requestedId,
          err: error instanceof Error ? error.message : String(error),
        },
        'native TorrentClaw metadata remapping failed; using original response'
      );
      return enrichSeasonPackSizes(original, type, options.formatting || {});
    }
  }

  private static generateAddon(
    _userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(options),
      enabled: true,
      mediaTypes: options.mediaTypes || [],
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options,
      },
      formatPassthrough: options.formatting?.useAioFormatter === false,
      resultPassthrough: options.resultPassthrough ?? false,
      pinPosition: options.pinPosition || undefined,
      headers: { 'User-Agent': this.METADATA.USER_AGENT },
    };
  }

  private static generateManifestUrl(options: Record<string, any>): string {
    let url = options.url || this.DEFAULT_URL;
    if (!url) {
      throw new Error(
        'TorrentClaw is not configured on this AIOStreams instance.'
      );
    }
    url = url.replace(/\/$/, '');
    return url.endsWith('/manifest.json') ? url : `${url}/manifest.json`;
  }
}
