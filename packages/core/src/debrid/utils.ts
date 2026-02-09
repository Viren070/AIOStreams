import { z } from 'zod';
import {
  constants,
  createLogger,
  BuiltinServiceId,
  Env,
  Cache,
  getSimpleTextHash,
  encryptString,
  toUrlSafeBase64,
} from '../utils/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  DebridFile,
  DebridDownload,
  PlaybackInfo,
  ServiceAuth,
  FileInfo,
  TitleMetadata,
} from './base.js';
import {
  normaliseTitle,
  preprocessTitle,
  titleMatch,
} from '../parser/utils.js';
import { partial_ratio } from 'fuzzball';
import { ParsedResult } from '@viren070/parse-torrent-title';

const logger = createLogger('debrid');

/**
 * Clean an NZB URL by stripping query parameters, ampersand parameters, and fragments.
 */
export function cleanNzbUrl(url: string): string {
  let cleaned = url;
  const qIndex = cleaned.indexOf('?');
  if (qIndex !== -1) {
    cleaned = cleaned.substring(0, qIndex);
  } else {
    const aIndex = cleaned.indexOf('&');
    if (aIndex !== -1) {
      cleaned = cleaned.substring(0, aIndex);
    }
  }
  const hIndex = cleaned.indexOf('#');
  if (hIndex !== -1) {
    cleaned = cleaned.substring(0, hIndex);
  }
  return cleaned;
}

/**
 * Compute an MD5 hash of a cleaned NZB URL.
 */
export function hashNzbUrl(url: string, clean: boolean = true): string {
  return createHash('md5')
    .update(clean ? cleanNzbUrl(url) : url)
    .digest('hex');
}

export const BuiltinDebridServices = z.array(
  z.object({
    id: z.enum(constants.BUILTIN_SUPPORTED_SERVICES),
    credential: z.string(),
  })
);

export type BuiltinDebridServices = z.infer<typeof BuiltinDebridServices>;

interface BaseFile {
  confirmed?: boolean; // whether the file has been confirmed to be the correct file for the media
  title?: string;
  size: number;
  index?: number;
  indexer?: string;
  seeders?: number;
  group?: string;
  age?: number; // age in hours
  duration?: number; // duration in seconds
  library?: boolean; // whether the file is already in the user's library
}

export interface Torrent extends BaseFile {
  type: 'torrent';
  downloadUrl?: string;
  sources: string[];
  hash: string;
  files?: DebridFile[];
  // magnet?: string;
  private?: boolean;
  placeholderHash?: boolean;
}

export interface UnprocessedTorrent extends BaseFile {
  type: 'torrent';
  hash?: string;
  downloadUrl?: string;
  sources: string[];
}

export interface NZB extends BaseFile {
  type: 'usenet';
  hash: string;
  nzb: string;
  easynewsUrl?: string;
  zyclopsHealth?: string;
}

export interface TorrentWithSelectedFile extends Torrent {
  file: DebridFile;
  service?: {
    id: BuiltinServiceId;
    cached: boolean;
    library: boolean;
  };
}

export interface NZBWithSelectedFile extends NZB {
  file: DebridFile;
  service?: {
    id: BuiltinServiceId;
    cached: boolean;
    library: boolean;
  };
}

interface SelectionOptions {
  chosenFilename?: string;
  chosenIndex?: number;
  useLevenshteinMatching?: boolean;
  skipSeasonEpisodeCheck?: boolean;
  printReport?: boolean;
  saveReport?: boolean;
}

interface SelectionReport {
  torrentTitle: string | undefined;
  timestamp: string;
  metadata: TitleMetadata | null;
  options: SelectionOptions | null;
  files: Array<{
    index: number;
    name: string | undefined;
    size: number;
    isVideo: boolean;
    isNotVideo: boolean;
    parsed: ParsedResult | null;
    scoreBreakdown: Record<string, number | string>;
    finalScore?: number;
    skipped: boolean;
    skipReason: string | null;
  }>;
  selectedFile: {
    name: string | undefined;
    index: number;
    score: number;
    size: number;
  } | null;
  skipped: boolean;
  skipReason: string | null;
}

// helpers
export const isSeasonWrong = (
  parsed: { seasons?: number[]; episodes?: number[] },
  metadata?: { season?: number; absoluteEpisode?: number }
) => {
  if (
    parsed.seasons?.length &&
    metadata?.season &&
    !parsed.seasons.includes(metadata.season)
  ) {
    // allow if season is "wrong" with value of 1 but absolute episode is correct
    if (
      parsed.seasons.length === 1 &&
      parsed.seasons[0] === 1 &&
      parsed.episodes?.length &&
      metadata.absoluteEpisode &&
      parsed.episodes.includes(metadata.absoluteEpisode)
    ) {
      return false;
    }
    return true;
  }
  return false;
};
export const isEpisodeWrong = (
  parsed: ParsedResult,
  metadata?: TitleMetadata
) => {
  if (
    parsed.episodes?.length &&
    metadata?.episode &&
    !(
      parsed.episodes.includes(metadata.episode) ||
      (metadata.absoluteEpisode &&
        parsed.episodes.includes(metadata.absoluteEpisode)) ||
      (metadata.relativeAbsoluteEpisode &&
        parsed.episodes.includes(metadata.relativeAbsoluteEpisode))
    )
  ) {
    return true;
  }
  return false;
};
export const isTitleWrong = (
  parsed: { title?: string },
  metadata?: { titles?: string[] }
) => {
  if (
    parsed.title &&
    metadata?.titles &&
    !titleMatch(
      normaliseTitle(parsed.title),
      metadata.titles.map(normaliseTitle),
      { threshold: 0.8 }
    )
  ) {
    return true;
  }
  return false;
};

export const isTitleWrongN = (
  parsed: { title?: string },
  metadata?: { titles?: string[] }
) => {
  if (parsed.title && metadata?.titles) {
    const normalisedParsedTitle = normaliseTitle(parsed.title);
    return !metadata.titles
      .map(normaliseTitle)
      .some((title) => title == normalisedParsedTitle);
  }
  return false;
};
export async function selectFileInTorrentOrNZB(
  torrentOrNZB: Torrent | NZB,
  debridDownload: DebridDownload,
  parsedFiles: Map<string, ParsedResult>,
  metadata?: TitleMetadata,
  options?: SelectionOptions
): Promise<DebridFile | undefined> {
  const report: SelectionReport = {
    torrentTitle: torrentOrNZB.title,
    timestamp: new Date().toISOString(),
    metadata: metadata || null,
    options: options || null,
    files: [],
    selectedFile: null,
    skipped: false,
    skipReason: null,
  };

  const handleReport = async () => {
    if (options?.printReport) {
      logger.debug(
        `Selection report for ${torrentOrNZB.title}: ${JSON.stringify(report, null, 2)}`
      );
    }
    if (options?.saveReport) {
      await saveReport(torrentOrNZB.title, report);
    }
  };

  if (!debridDownload.files?.length) {
    report.skipped = true;
    report.skipReason = 'No files in debrid download';
    await handleReport();
    return {
      name: torrentOrNZB.title,
      size: torrentOrNZB.size,
      index: -1,
    };
  }

  const isVideo = debridDownload.files.map((file) => isVideoFile(file));
  const isNotVideo = debridDownload.files.map((file) => isNotVideoFile(file));
  const videoExists = isVideo.map((f) => f == true);

  // Create a scoring system for each file
  const fileScores = [];
  for (let index = 0; index < debridDownload.files.length; index++) {
    const file = debridDownload.files[index];
    let score = 0;
    const parsed = parsedFiles.get(file.name ?? '');
    const fileReport: SelectionReport['files'][number] = {
      index,
      name: file.name,
      size: file.size,
      isVideo: isVideo[index],
      isNotVideo: isNotVideo[index],
      parsed: parsed || null,
      scoreBreakdown: {},
      finalScore: 0,
      skipped: false,
      skipReason: null,
    };

    if (isNotVideo[index]) {
      fileReport.skipped = true;
      fileReport.skipReason = 'Not a video file';
      report.files.push(fileReport);
      continue;
    }

    if (!parsed) {
      logger.warn(`Parsed file not found for ${file.name}`);
      fileReport.skipped = true;
      fileReport.skipReason = 'No parsed metadata available';
      report.files.push(fileReport);
      continue;
    }

    if (
      file.name &&
      ['sample', 'trailer', 'preview'].some((keyword) =>
        file.name!.toLowerCase().includes(keyword)
      )
    ) {
      score -= 500;
      fileReport.scoreBreakdown.sampleTrailerPenalty = -500;
    }

    // Base score from video file status (highest priority)
    if (isVideo[index]) {
      score += 1000;
      fileReport.scoreBreakdown.videoFileBonus = 1000;
    }

    if (
      // !(metadata?.season && metadata?.episode && metadata?.absoluteEpisode) &&
      metadata?.year &&
      parsed?.year
    ) {
      if (metadata.year === Number(parsed.year)) {
        score += 500;
        fileReport.scoreBreakdown.yearMatch = 500;
      }
    }

    // Season year matching (for anime)
    if (metadata?.seasonYear && parsed?.year) {
      if (metadata.seasonYear === Number(parsed.year)) {
        score += 750;
        fileReport.scoreBreakdown.seasonYearMatch = 750;
      }
    }

    // Season/Episode matching (second highest priority)
    if (parsed && !isSeasonWrong(parsed, metadata)) {
      score += 500;
      fileReport.scoreBreakdown.seasonMatch = 500;
    }
    if (!parsed?.seasons?.length && metadata?.season) {
      score -= 500;
      fileReport.scoreBreakdown.missingSeasonPenalty = -500;
    }

    if (parsed && !isEpisodeWrong(parsed, metadata)) {
      const parsedEpisodesCount = parsed.episodes?.length || 0;
      const parsedHasSeason = parsed.seasons && parsed.seasons.length > 0;
      const isExactMatch = parsedEpisodesCount === 1;
      const isBatchMatch = parsedEpisodesCount > 1;

      // For files without season info: prefer absolute episode matches over regular episode
      if (
        !parsedHasSeason &&
        metadata?.season &&
        metadata?.absoluteEpisode &&
        metadata?.episode
      ) {
        const matchesAbsolute = parsed.episodes?.includes(
          metadata.absoluteEpisode
        );
        const matchesRelativeAbsolute = metadata.relativeAbsoluteEpisode
          ? parsed.episodes?.includes(metadata.relativeAbsoluteEpisode)
          : false;
        const matchesRegular = parsed.episodes?.includes(metadata.episode);

        if (matchesAbsolute && isExactMatch) {
          score += 2000;
          fileReport.scoreBreakdown.episodeMatchType = 'exactAbsolute';
          fileReport.scoreBreakdown.episodeScore = 2000;
        } else if (matchesAbsolute && isBatchMatch) {
          score += 500;
          fileReport.scoreBreakdown.episodeMatchType = 'batchAbsolute';
          fileReport.scoreBreakdown.episodeScore = 500;
        } else if (matchesRelativeAbsolute && isExactMatch) {
          score += 1000;
          fileReport.scoreBreakdown.episodeMatchType = 'exactRelativeAbsolute';
          fileReport.scoreBreakdown.episodeScore = 1000;
        } else if (matchesRelativeAbsolute && isBatchMatch) {
          score += 300;
          fileReport.scoreBreakdown.episodeMatchType = 'batchRelativeAbsolute';
          fileReport.scoreBreakdown.episodeScore = 300;
        } else if (matchesRegular && isExactMatch) {
          score += 300;
          fileReport.scoreBreakdown.episodeMatchType = 'exactRegular';
          fileReport.scoreBreakdown.episodeScore = 300;
        } else if (matchesRegular && isBatchMatch) {
          score += 100;
          fileReport.scoreBreakdown.episodeMatchType = 'batchRegular';
          fileReport.scoreBreakdown.episodeScore = 100;
        }
      } else if (
        parsedHasSeason &&
        metadata?.season &&
        metadata?.absoluteEpisode &&
        metadata?.episode &&
        metadata.absoluteEpisode !== metadata.episode
      ) {
        // File has season info: prefer regular episode over absolute.
        const matchesRegular = parsed.episodes?.includes(metadata.episode);
        const matchesAbsolute = parsed.episodes?.includes(
          metadata.absoluteEpisode
        );
        const matchesRelativeAbsolute = metadata.relativeAbsoluteEpisode
          ? parsed.episodes?.includes(metadata.relativeAbsoluteEpisode)
          : false;

        if (matchesRegular && isExactMatch) {
          score += 750;
          fileReport.scoreBreakdown.episodeMatchType = 'exact';
          fileReport.scoreBreakdown.episodeScore = 750;
        } else if (matchesRegular && isBatchMatch) {
          score += 250;
          fileReport.scoreBreakdown.episodeMatchType = 'batch';
          fileReport.scoreBreakdown.episodeScore = 250;
        } else if (matchesAbsolute && isExactMatch) {
          score += 200;
          fileReport.scoreBreakdown.episodeMatchType =
            'exactAbsoluteWithSeason';
          fileReport.scoreBreakdown.episodeScore = 200;
        } else if (matchesRelativeAbsolute && isExactMatch) {
          score += 150;
          fileReport.scoreBreakdown.episodeMatchType =
            'exactRelativeAbsoluteWithSeason';
          fileReport.scoreBreakdown.episodeScore = 150;
        } else if (matchesAbsolute && isBatchMatch) {
          score += 100;
          fileReport.scoreBreakdown.episodeMatchType =
            'batchAbsoluteWithSeason';
          fileReport.scoreBreakdown.episodeScore = 100;
        } else if (matchesRelativeAbsolute && isBatchMatch) {
          score += 50;
          fileReport.scoreBreakdown.episodeMatchType =
            'batchRelativeAbsoluteWithSeason';
          fileReport.scoreBreakdown.episodeScore = 50;
        }
      } else {
        // Standard scoring: strongly prefer exact episodes over batches
        if (isExactMatch) {
          score += 750;
          fileReport.scoreBreakdown.episodeMatchType = 'exact';
          fileReport.scoreBreakdown.episodeScore = 750;
        } else if (isBatchMatch) {
          score += 250;
          fileReport.scoreBreakdown.episodeMatchType = 'batch';
          fileReport.scoreBreakdown.episodeScore = 250;
        }
      }
    }
    if (
      !parsed?.episodes?.length &&
      (metadata?.episode || metadata?.absoluteEpisode)
    ) {
      score -= 500;
      fileReport.scoreBreakdown.missingEpisodePenalty = -500;
    }

    // Title matching (third priority)
    const titleMatchFunc =
      options?.useLevenshteinMatching == false ? isTitleWrongN : isTitleWrong;
    if (
      parsed?.title &&
      (videoExists ? isVideo[index] : true) &&
      !titleMatchFunc(
        {
          title: preprocessTitle(
            parsed.title,
            torrentOrNZB.title ?? '',
            metadata?.titles ?? []
          ),
        },
        metadata
      )
    ) {
      score += 100;
      fileReport.scoreBreakdown.titleMatch = 100;
    }

    // Size based score (lowest priority but still relevant)
    // We normalize the size to be between 0 and 50 points
    const files = debridDownload.files || [];
    const maxSize =
      torrentOrNZB.size || files.reduce((max, f) => Math.max(max, f.size), 0);
    const sizeScore = maxSize > 0 ? (file.size / maxSize) * 50 : 0;
    score += sizeScore;
    fileReport.scoreBreakdown.sizeScore = sizeScore;

    // Small boost for chosen index/filename if provided
    if (options?.chosenIndex === index) {
      score += 25;
      fileReport.scoreBreakdown.chosenIndexBonus = 25;
    }
    if (
      options?.chosenFilename &&
      torrentOrNZB.title?.includes(options.chosenFilename)
    ) {
      score += 25;
      fileReport.scoreBreakdown.chosenFilenameBonus = 25;
    }

    fileReport.finalScore = Math.max(score, 0);
    report.files.push(fileReport);

    fileScores.push({
      file,
      score: Math.max(score, 0),
      index,
    });

    if ((index + 1) % 10 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  if (fileScores.length === 0) {
    logger.warn(`Torrent ${torrentOrNZB.title} had no files selected`, {
      files: debridDownload.files.map((f) => f.name),
    });
    report.skipped = true;
    report.skipReason = 'No valid video files with scores';
    await handleReport();
    return undefined;
  }
  // Sort by score descending
  fileScores.sort((a, b) => b.score - a.score);

  // Select the best matching file
  const bestMatch = fileScores[0];
  // return bestMatch.file;
  const parsedFile = parsedFiles.get(bestMatch.file.name ?? '');
  const parsedTitle = parsedFiles.get(torrentOrNZB.title ?? '');

  if (
    metadata &&
    parsedFile &&
    parsedTitle &&
    !options?.skipSeasonEpisodeCheck
  ) {
    // if (
    //   !isSeasonWrong(parsed, metadata) &&
    //   !isSeasonWrong(parsedTorrentOrNZB, metadata)
    // ) {
    //   logger.debug(
    //     `Season ${metadata.season} not found in ${torrentOrNZB.title} and ${bestMatch.file.name}, skipping...`
    //   );
    //   return undefined;
    // }
    if (
      isEpisodeWrong(parsedFile, metadata) ||
      isEpisodeWrong(parsedTitle, metadata)
    ) {
      logger.debug(
        `Episode ${metadata.episode} or ${metadata.absoluteEpisode} not found in ${torrentOrNZB.title} and ${bestMatch.file.name}, skipping...`
      );
      report.skipped = true;
      report.skipReason = `Invalid episode number - Expected ${metadata.episode} or ${metadata.absoluteEpisode}, not found in file or torrent`;
      await handleReport();
      return undefined;
    }
  }

  report.selectedFile = {
    name: bestMatch.file.name,
    index: bestMatch.index,
    score: bestMatch.score,
    size: bestMatch.file.size,
  };
  handleReport();
  return bestMatch.file;
}

async function saveReport(
  torrentTitle: string | undefined,
  report: any
): Promise<void> {
  try {
    const reportsDir = path.join(process.cwd(), 'reports');
    await fs.mkdir(reportsDir, { recursive: true });

    const sanitizedTitle = (torrentTitle || 'unknown').replace(
      /[^a-z0-9\.]/gi,
      ''
    );
    const filename = `${sanitizedTitle}_${Date.now()}.json`;
    const filepath = path.join(reportsDir, filename);

    await fs.writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Failed to save selection report:', error);
  }
}

export const VIDEO_FILE_EXTENSIONS = [
  '.3g2',
  '.3gp',
  '.amv',
  '.asf',
  '.avi',
  '.drc',
  '.f4a',
  '.f4b',
  '.f4p',
  '.f4v',
  '.flv',
  '.gif',
  '.gifv',
  '.iso',
  '.m2v',
  '.m4p',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp2',
  '.mp4',
  '.mpg',
  '.mpeg',
  '.mpv',
  '.mng',
  '.mpe',
  '.mxf',
  '.nsv',
  '.ogg',
  '.ogv',
  '.qt',
  '.rm',
  '.rmvb',
  '.roq',
  '.svi',
  '.webm',
  '.wmv',
  '.yuv',
  '.m3u8',
  '.m2ts',
];

export function isVideoFile(file: DebridFile): boolean {
  return (
    file.mimeType?.includes('video') ||
    VIDEO_FILE_EXTENSIONS.some((ext) => file.name?.endsWith(ext) ?? false)
  );
}

export function isNotVideoFile(file: DebridFile): boolean {
  const nonVideoExtensions = [
    '.txt',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.svg',
    '.webp',
    '.nfo',
    '.sfv',
    '.srt',
    '.ass',
    '.sub',
    '.idx',
    '.cue',
    '.log',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.pdf',
    '.rtf',
    '.odt',
    '.ods',
    '.odp',
    '.csv',
    '.tsv',
    '.exe',
    '.bat',
    '.apk',
    '.dll',
    '.zip',
    '.rar',
    '.7z',
    '.tar',
    '.gz',
    '.bz2',
    '.xz',
    '.md',
    '.json',
    '.xml',
    '.ini',
    '.dat',
    '.db',
    '.dbf',
    '.bak',
  ];
  const patterns = [/\.7z\.\d+$/];
  return (
    (file.mimeType && !file.mimeType.includes('video')) ||
    nonVideoExtensions.some((ext) => file.name?.endsWith(ext) ?? false) ||
    patterns.some((pattern) => pattern.test(file.name || ''))
  );
}

export const metadataStore = () => {
  const prefix = 'mds';
  const store: 'redis' | 'sql' | 'memory' =
    Env.BUILTIN_DEBRID_METADATA_STORE || (Env.REDIS_URI ? 'redis' : 'sql');
  return Cache.getInstance<string, TitleMetadata>(prefix, 1_000_000_000, store);
};

export const fileInfoStore = () => {
  const prefix = 'fis';
  let store: 'redis' | 'sql' | 'memory' | undefined;
  if (Env.BUILTIN_DEBRID_FILEINFO_STORE === true) {
    store = Env.REDIS_URI ? 'redis' : 'sql';
  } else if (!Env.BUILTIN_DEBRID_FILEINFO_STORE) {
    return undefined;
  } else {
    store = Env.BUILTIN_DEBRID_FILEINFO_STORE;
  }
  return Cache.getInstance<string, FileInfo>(prefix, 1_000_000_000, store);
};

// export function generatePlaybackUrl(
//   storeAuth: ServiceAuth,
//   playbackInfo: MinimisedPlaybackInfo,
//   filename: string
// ) {
//   const encryptedStoreAuth = encryptString(JSON.stringify(storeAuth));
//   if (!encryptedStoreAuth.success) {
//     throw new Error('Failed to encrypt store auth');
//   }
//   const playbackId = getSimpleTextHash(JSON.stringify(playbackInfo));
//   pbiCache().set(playbackId, playbackInfo, Env.BUILTIN_PLAYBACK_LINK_VALIDITY);
//   return `${Env.BASE_URL}/api/v1/debrid/playback/${encryptedStoreAuth.data}/${playbackId}/${encodeURIComponent(filename)}`;
// }

export function generatePlaybackUrl(
  encryptedStoreAuth: string,
  metadataId: string,
  fileInfo: FileInfo,
  filename?: string
): string {
  const fileInfoCache = fileInfoStore();
  let fileInfoStr: string = toUrlSafeBase64(JSON.stringify(fileInfo));
  if (fileInfoCache && fileInfoStr.length > 500) {
    fileInfoStr = getSimpleTextHash(JSON.stringify(fileInfo));
    fileInfoCache.set(
      fileInfoStr,
      fileInfo,
      Env.BUILTIN_PLAYBACK_LINK_VALIDITY
    );
  }
  return `${Env.BASE_URL}/api/v1/debrid/playback/${encryptedStoreAuth}/${fileInfoStr}/${metadataId}/${encodeURIComponent(filename ?? 'unknown')}`;
}
