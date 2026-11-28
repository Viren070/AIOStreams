import * as constants from '../../../../../../core/src/utils/constants';
import {
  ParsedFile,
  ParsedStream,
} from '../../../../../../core/src/db/schemas';
import FileParser from '../../../../../../core/src/parser/file';
import {
  mergeParsedFiles,
  applySeasonPackHeuristics,
} from '../../../../../../core/src/parser/merge';

/**
 * Every value the preview can vary. One object rather than one useState per
 * field: the format effect then has a single dependency, and persistence and
 * scenarios are plain object operations.
 */
export interface PreviewInput {
  scenario: string;

  filename: string;
  folderName: string;
  /** key present = the user overrode what the parser produced */
  parsedFileOverrides: Partial<ParsedFile>;

  type: (typeof constants.STREAM_TYPES)[number];
  serviceId: constants.ServiceId | 'none';
  cached: boolean;
  addonName: string;
  presetId: string;
  manifestUrl: string;
  indexer: string;
  seeders?: number;
  age: string;
  /** milliseconds */
  duration?: number;
  size?: number;
  folderSize?: number;
  /** blank derives it from size and duration, as the engine does */
  bitrate?: number;
  failovers: number;
  infoHash: string;
  message: string;
  library: boolean;
  proxied: boolean;
  private: boolean;
  freeleech: boolean;
  preloading: boolean;

  metadata: PreviewMetadata;

  regexMatched: string;
  regexScore?: number;
  maxRegexScore?: number;
  rankedRegexMatched: string;
  seMatched: string;
  seScore?: number;
  maxSeScore?: number;
  rseMatched: string;
  seadex: boolean;
  seadexBest: boolean;
}

/**
 * The request-scoped half of FormatterContext. `queryType` is absent because the
 * engine derives it, and the score ceilings live on PreviewInput next to the
 * scores they normalise.
 */
export interface PreviewMetadata {
  type: string;
  isAnime: boolean;
  title: string;
  /** comma separated */
  titles: string;
  year?: number;
  yearEnd?: number;
  season?: number;
  episode?: number;
  /** comma separated; the first also feeds metadata.episodeTitle */
  episodeTitles: string;
  /** comma separated */
  genres: string;
  runtime?: number;
  episodeRuntime?: number;
  absoluteEpisode?: number;
  relativeAbsoluteEpisode?: number;
  originalLanguage: string;
  country: string;
  latestSeason?: number;
  daysSinceRelease?: number;
  daysSinceFirstAired?: number;
  daysSinceLastAired?: number;
  hasNextEpisode: boolean;
  daysUntilNextEpisode?: number;
  anilistId?: number;
  malId?: number;
  hasSeaDex: boolean;
}

const DEFAULT_METADATA: PreviewMetadata = {
  type: constants.MOVIE_TYPE,
  isAnime: false,
  title: 'Sample Movie',
  titles: 'Sample Movie, Sample Movie Alt Title',
  year: 2024,
  yearEnd: undefined,
  season: undefined,
  episode: undefined,
  episodeTitles: '',
  genres: 'Action, Thriller',
  runtime: 120,
  episodeRuntime: undefined,
  absoluteEpisode: undefined,
  relativeAbsoluteEpisode: undefined,
  originalLanguage: 'English',
  country: 'US',
  latestSeason: undefined,
  daysSinceRelease: 30,
  daysSinceFirstAired: undefined,
  daysSinceLastAired: undefined,
  hasNextEpisode: false,
  daysUntilNextEpisode: undefined,
  anilistId: undefined,
  malId: undefined,
  hasSeaDex: false,
};

export const MAX_PREVIEW_FAILOVERS = 50;

export const DEFAULT_PREVIEW_INPUT: PreviewInput = {
  scenario: 'movie',

  filename:
    'Movie.Title.2023.2160p.BluRay.HEVC.DV.TrueHD.Atmos.7.1.iTA.ENG-GROUP.mkv',
  folderName:
    'Movie.Title.2023.2160p.BluRay.HEVC.DV.TrueHD.Atmos.7.1.iTA.ENG-GROUP',
  parsedFileOverrides: {},

  type: 'debrid',
  serviceId: 'none',
  cached: true,
  addonName: 'Torrentio',
  presetId: 'custom',
  manifestUrl: 'http://localhost:2000/manifest.json',
  indexer: 'RARBG',
  seeders: 125,
  age: '10d',
  duration: 9120000,
  size: 62500000000,
  folderSize: 125000000000,
  bitrate: undefined,
  failovers: 0,
  infoHash: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
  message: 'This is a message',
  library: false,
  proxied: false,
  private: false,
  freeleech: false,
  preloading: false,

  metadata: DEFAULT_METADATA,

  regexMatched: '',
  regexScore: 25,
  maxRegexScore: 50,
  rankedRegexMatched: '',
  seMatched: '',
  seScore: 150,
  maxSeScore: 100,
  rseMatched: '',
  seadex: false,
  seadexBest: false,
};

/**
 * Which template fields each tab can drive. Used only to decide, under the
 * "only used fields" filter, whether a whole tab is worth showing. Parsed File
 * takes every stream field the others do not claim, so a new parser field lands
 * there by default rather than vanishing.
 */
const SOURCE_FIELDS = ['stream.filename', 'stream.folderName'];

const STREAM_FIELDS = [
  'stream.type',
  'stream.indexer',
  'stream.seeders',
  'stream.age',
  'stream.ageHours',
  'stream.duration',
  'stream.size',
  'stream.folderSize',
  'stream.bitrate',
  'stream.failovers',
  'stream.infoHash',
  'stream.message',
  'stream.library',
  'stream.private',
  'stream.freeleech',
  'stream.proxied',
  'stream.preloading',
  'service.id',
  'service.name',
  'service.shortName',
  'service.cached',
  'addon.name',
  'addon.presetId',
  'addon.manifestUrl',
];

const SCORING_FIELDS = [
  'stream.regexMatched',
  'stream.regexScore',
  'stream.nRegexScore',
  'stream.rankedRegexMatched',
  'stream.seMatched',
  'stream.seScore',
  'stream.nSeScore',
  'stream.rseMatched',
  'stream.seadex',
  'stream.seadexBest',
];

export const TAB_FIELDS: Record<string, readonly string[]> = {
  source: SOURCE_FIELDS,
  stream: STREAM_FIELDS,
  scoring: SCORING_FIELDS,
  metadata: [], // every metadata.* field; matched by prefix below
  parsed: [], // the leftover stream.* parser fields; matched by exclusion below
};

/** True when this tab has at least one field the template reads. */
export function tabHasUsedField(
  tab: string,
  used: ReadonlySet<string>
): boolean {
  if (tab === 'metadata') {
    return [...used].some((field) => field.startsWith('metadata.'));
  }
  if (tab === 'parsed') {
    const claimed = new Set([
      ...SOURCE_FIELDS,
      ...STREAM_FIELDS,
      ...SCORING_FIELDS,
    ]);
    return [...used].some(
      (field) => field.startsWith('stream.') && !claimed.has(field)
    );
  }
  return (TAB_FIELDS[tab] ?? []).some((field) => used.has(field));
}

export interface PreviewScenario {
  id: string;
  label: string;
  input: Partial<Omit<PreviewInput, 'metadata'>> & {
    metadata?: Partial<PreviewMetadata>;
  };
}

/**
 * Coherent starting points. Filling twenty metadata fields by hand to preview a
 * series template is the kind of tedium that stops people trying.
 */
export const PREVIEW_SCENARIOS: readonly PreviewScenario[] = [
  { id: 'movie', label: 'Movie', input: {} },
  {
    id: 'series',
    label: 'Series episode',
    input: {
      filename:
        'Series.Title.S02E05.The.Episode.Name.1080p.WEB-DL.DDP5.1.H.264-GROUP.mkv',
      folderName: 'Series.Title.S02.1080p.WEB-DL.DDP5.1.H.264-GROUP',
      size: 3500000000,
      folderSize: 35000000000,
      duration: 2700000,
      metadata: {
        type: constants.SERIES_TYPE,
        title: 'Series Title',
        titles: 'Series Title, Series Title (US)',
        year: 2019,
        yearEnd: 2024,
        season: 2,
        episode: 5,
        episodeTitles: 'The Episode Name',
        genres: 'Drama, Mystery',
        runtime: 3000,
        episodeRuntime: 45,
        latestSeason: 4,
        daysSinceRelease: 2,
        daysSinceFirstAired: 1830,
        daysSinceLastAired: 2,
        hasNextEpisode: true,
        daysUntilNextEpisode: 5,
      },
    },
  },
  {
    id: 'anime',
    label: 'Anime episode',
    input: {
      filename: '[SubsPlease] Anime Title - 13 (1080p) [A1B2C3D4].mkv',
      folderName: '[SubsPlease] Anime Title (01-24) (1080p)',
      size: 1400000000,
      folderSize: 33600000000,
      duration: 1440000,
      seadex: true,
      metadata: {
        type: constants.SERIES_TYPE,
        isAnime: true,
        title: 'Anime Title',
        titles: 'Anime Title, アニメタイトル',
        year: 2024,
        season: 2,
        episode: 1,
        absoluteEpisode: 13,
        relativeAbsoluteEpisode: 1,
        episodeTitles: 'The Episode Name',
        genres: 'Action, Fantasy',
        originalLanguage: 'Japanese',
        country: 'JP',
        runtime: 576,
        episodeRuntime: 24,
        anilistId: 21,
        malId: 21,
        hasSeaDex: true,
        daysSinceRelease: 1,
        hasNextEpisode: true,
        daysUntilNextEpisode: 7,
      },
    },
  },
  {
    id: 'season-pack',
    label: 'Season pack',
    input: {
      filename:
        'Series.Title.S02.COMPLETE.2160p.WEB-DL.DV.HDR10.DDP5.1.H.265-GROUP',
      size: 84000000000,
      folderSize: 84000000000,
      duration: undefined,
      type: 'p2p',
      seeders: 42,
      metadata: {
        type: constants.SERIES_TYPE,
        title: 'Series Title',
        titles: 'Series Title',
        year: 2019,
        season: 2,
        genres: 'Drama, Mystery',
        latestSeason: 4,
        daysSinceRelease: 400,
      },
    },
  },
  {
    id: 'usenet',
    label: 'Usenet release',
    input: {
      filename:
        'Movie.Title.2023.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.7.1.Atmos-GROUP.mkv',
      folderName:
        'Movie.Title.2023.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.7.1.Atmos-GROUP',
      type: 'usenet',
      serviceId: 'aiostreams',
      indexer: 'NZBGeek',
      addonName: 'Newznab',
      age: '400d',
      seeders: undefined,
      size: 82000000000,
      folderSize: 82000000000,
    },
  },
];

/** A scenario replaces the whole input, so switching never leaves stale fields. */
export function applyScenario(id: string): PreviewInput {
  const scenario = PREVIEW_SCENARIOS.find((s) => s.id === id);
  if (!scenario) return { ...DEFAULT_PREVIEW_INPUT, scenario: id };
  return {
    ...DEFAULT_PREVIEW_INPUT,
    ...scenario.input,
    metadata: { ...DEFAULT_METADATA, ...scenario.input.metadata },
    scenario: id,
  };
}

/* ------------------------------------------------------------------ storage */

const STORAGE_KEY = 'aiostreams:formatter-preview';
// bump when PreviewInput changes shape so stale state falls back to defaults
const STORAGE_VERSION = 2;

export function loadPreviewInput(): PreviewInput {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREVIEW_INPUT;
    const stored = JSON.parse(raw);
    if (stored?.version !== STORAGE_VERSION) return DEFAULT_PREVIEW_INPUT;
    return {
      ...DEFAULT_PREVIEW_INPUT,
      ...stored.input,
      metadata: { ...DEFAULT_METADATA, ...stored.input?.metadata },
      parsedFileOverrides: stored.input?.parsedFileOverrides ?? {},
    };
  } catch {
    return DEFAULT_PREVIEW_INPUT;
  }
}

export function savePreviewInput(input: PreviewInput): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, input })
    );
  } catch {
    // preview state is disposable; a full or blocked store is not worth a toast
  }
}

/* ------------------------------------------------------------------ builders */

export function parseAgeToHours(age: string): number | undefined {
  const match = age.match(/^(\d+)([a-zA-Z])$/);
  if (!match) return undefined;
  const value = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case 'd':
      return value * 24;
    case 'h':
      return value;
    case 'm':
      return value / 60;
    case 'y':
      return value * 24 * 365;
    default:
      return undefined;
  }
}

export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * The same three steps the real parsers take: parse both names, merge with
 * overrides standing in for media info, then apply the season pack heuristics.
 */
export function buildParsedFile(input: PreviewInput): ParsedFile | undefined {
  const fileParsed = input.filename
    ? FileParser.parse(input.filename)
    : undefined;
  const folderParsed = input.folderName
    ? FileParser.parse(input.folderName)
    : undefined;
  const merged = mergeParsedFiles(
    fileParsed,
    folderParsed,
    input.parsedFileOverrides
  );
  if (!merged) return undefined;
  return applySeasonPackHeuristics(merged, {
    size: input.size,
    folderSize: input.folderSize,
  });
}

/** What the parser produced before any override, for the parsed file panel. */
export function buildParsedFileWithoutOverrides(
  input: PreviewInput
): ParsedFile | undefined {
  return buildParsedFile({ ...input, parsedFileOverrides: {} });
}

/** bits per second from size and duration, matching the engine's fallback. */
export function deriveBitrate(input: PreviewInput): number | undefined {
  return input.size && input.duration
    ? Math.floor((input.size * 8) / (input.duration / 1000))
    : undefined;
}

export function buildParsedStream(input: PreviewInput): ParsedStream {
  const parsedFile = buildParsedFile(input);
  const bitrate = input.bitrate ?? deriveBitrate(input);

  return {
    id: 'preview',
    type: input.type,
    addon: {
      name: input.addonName,
      preset: { type: input.presetId, id: input.presetId, options: {} },
      enabled: true,
      // the schema demands a URL, and a half-typed one would 400 every keystroke
      manifestUrl: isValidUrl(input.manifestUrl)
        ? input.manifestUrl
        : DEFAULT_PREVIEW_INPUT.manifestUrl,
      timeout: 10000,
    },
    library: input.library,
    failoverVariants: Array.from(
      { length: Math.min(input.failovers, MAX_PREVIEW_FAILOVERS) },
      (_, i) => ({
        url: `https://example.com/playback/${i}`,
        type: 'usenet' as const,
      })
    ),
    parsedFile,
    filename: input.filename,
    folderName: input.folderName,
    folderSize: input.folderSize,
    indexer: input.indexer,
    regexMatched: { name: input.regexMatched || undefined, index: 0 },
    torrent: {
      infoHash: input.type === 'p2p' ? input.infoHash || undefined : undefined,
      seeders: input.seeders,
      private: input.private,
      freeleech: input.freeleech,
    },
    service:
      input.serviceId === 'none'
        ? undefined
        : { id: input.serviceId, cached: input.cached },
    age: parseAgeToHours(input.age),
    duration: input.duration,
    size: input.size,
    bitrate,
    proxied: input.proxied,
    preloading: input.preloading,
    message: input.message,
    seadex: {
      isSeadex: input.seadex,
      isBest: input.seadex && input.seadexBest,
    },
    streamExpressionScore: input.seScore,
    streamExpressionMatched: input.seMatched
      ? { name: input.seMatched, index: 0 }
      : undefined,
    rankedStreamExpressionsMatched: splitList(input.rseMatched),
    regexScore: input.regexScore,
    rankedRegexesMatched: splitList(input.rankedRegexMatched),
  };
}

/** Empty means absent: null clears the endpoint's dummy default, undefined would not survive JSON. */
function orNull<T>(value: T | undefined | null): T | null {
  return value === undefined || value === '' ? null : value;
}

function listOrNull(value: string): string[] | null {
  const list = splitList(value);
  return list.length ? list : null;
}

export function buildFormatterContext(
  input: PreviewInput
): Record<string, unknown> {
  const metadata = input.metadata;
  const type = orNull(metadata.type);
  return {
    type,
    // the engine composes it the same way from type and isAnime
    queryType: type ? (metadata.isAnime ? `anime.${type}` : type) : null,
    isAnime: metadata.isAnime,
    title: orNull(metadata.title),
    titles: listOrNull(metadata.titles),
    year: orNull(metadata.year),
    yearEnd: orNull(metadata.yearEnd),
    season: orNull(metadata.season),
    episode: orNull(metadata.episode),
    episodeTitles: listOrNull(metadata.episodeTitles),
    genres: listOrNull(metadata.genres),
    runtime: orNull(metadata.runtime),
    episodeRuntime: orNull(metadata.episodeRuntime),
    absoluteEpisode: orNull(metadata.absoluteEpisode),
    relativeAbsoluteEpisode: orNull(metadata.relativeAbsoluteEpisode),
    originalLanguage: orNull(metadata.originalLanguage),
    country: orNull(metadata.country),
    latestSeason: orNull(metadata.latestSeason),
    daysSinceRelease: orNull(metadata.daysSinceRelease),
    daysSinceFirstAired: orNull(metadata.daysSinceFirstAired),
    daysSinceLastAired: orNull(metadata.daysSinceLastAired),
    hasNextEpisode: metadata.hasNextEpisode,
    daysUntilNextEpisode: orNull(metadata.daysUntilNextEpisode),
    anilistId: orNull(metadata.anilistId),
    malId: orNull(metadata.malId),
    hasSeaDex: metadata.hasSeaDex,
    maxRegexScore: orNull(input.maxRegexScore),
    maxSeScore: orNull(input.maxSeScore),
  };
}
