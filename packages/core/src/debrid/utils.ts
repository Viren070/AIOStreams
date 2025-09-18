import { z } from 'zod';
import { constants, createLogger, BuiltinServiceId } from '../utils/index.js';
import { DebridFile, DebridDownload } from './base.js';
import { normaliseTitle, titleMatch } from '../parser/utils.js';

const logger = createLogger('debrid');

export const BuiltinDebridServices = z.array(
  z.object({
    id: z.enum(constants.BUILTIN_SUPPORTED_SERVICES),
    credential: z.string(),
  })
);

export type BuiltinDebridServices = z.infer<typeof BuiltinDebridServices>;

interface BaseFile {
  title?: string;
  size: number;
  index?: number;
  indexer?: string;
  seeders?: number;
  age?: string;
}

export interface Torrent extends BaseFile {
  type: 'torrent';
  downloadUrl?: string;
  sources: string[];
  hash: string;
  files?: DebridFile[];
  // magnet?: string;
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
}

export interface TorrentWithSelectedFile extends Torrent {
  file: DebridFile;
  service?: {
    id: BuiltinServiceId;
    cached: boolean;
    owned: boolean;
  };
}

export interface NZBWithSelectedFile extends NZB {
  file: DebridFile;
  service?: {
    id: BuiltinServiceId;
    cached: boolean;
    owned: boolean;
  };
}

// helpers
export const isSeasonWrong = (
  parsed: { seasons?: number[] },
  metadata?: { season?: number }
) => {
  if (
    parsed.seasons?.length &&
    metadata?.season &&
    !parsed.seasons.includes(metadata.season)
  ) {
    return true;
  }
  return false;
};
export const isEpisodeWrong = (
  parsed: { episodes?: number[] },
  metadata?: { episode?: number; absoluteEpisode?: number }
) => {
  if (
    parsed.episodes?.length &&
    metadata?.episode &&
    !(
      parsed.episodes.includes(metadata.episode) ||
      (metadata.absoluteEpisode &&
        parsed.episodes.includes(metadata.absoluteEpisode))
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

export async function selectFileInTorrentOrNZB(
  torrentOrNZB: Torrent | NZB,
  debridDownload: DebridDownload,
  parsedFiles: Map<
    string,
    {
      title?: string;
      seasons?: number[];
      episodes?: number[];
    }
  >,

  metadata?: {
    titles: string[];
    season?: number;
    episode?: number;
    absoluteEpisode?: number;
  },
  options?: {
    chosenFilename?: string;
    chosenIndex?: number;
  }
): Promise<DebridFile | undefined> {
  if (!debridDownload.files?.length) {
    return {
      name: torrentOrNZB.title,
      size: torrentOrNZB.size,
      index: -1,
    };
  }

  const isVideo = debridDownload.files.map((file) => isVideoFile(file));

  // Create a scoring system for each file
  const fileScores = debridDownload.files.map((file, index) => {
    let score = 0;
    const parsed = parsedFiles.get(file.name ?? '');

    if (!parsed) {
      logger.warn(`Parsed file not found for ${file.name}`);
    }

    // Base score from video file status (highest priority)
    if (isVideo[index]) {
      score += 1000;
    }

    // Season/Episode matching (second highest priority)
    if (parsed && !isSeasonWrong(parsed, metadata)) {
      score += 500;
    }
    if (parsed && !isEpisodeWrong(parsed, metadata)) {
      score += 500;
    }

    // Title matching (third priority)
    if (parsed && !isTitleWrong(parsed, metadata)) {
      score += 100;
    }

    // Size based score (lowest priority but still relevant)
    // We normalize the size to be between 0 and 50 points
    const files = debridDownload.files || [];
    const maxSize =
      torrentOrNZB.size || files.reduce((max, f) => Math.max(max, f.size), 0);
    score += maxSize > 0 ? (file.size / maxSize) * 50 : 0;

    // Small boost for chosen index/filename if provided
    if (options?.chosenIndex === index) {
      score += 25;
    }
    if (
      options?.chosenFilename &&
      torrentOrNZB.title?.includes(options.chosenFilename)
    ) {
      score += 25;
    }
    return {
      file,
      score,
      index,
    };
  });

  // Sort by score descending
  fileScores.sort((a, b) => b.score - a.score);

  // Select the best matching file
  const bestMatch = fileScores[0];
  // return bestMatch.file;
  const parsedFile = parsedFiles.get(bestMatch.file.name ?? '');
  const parsedTitle = parsedFiles.get(torrentOrNZB.title ?? '');

  if (metadata && parsedFile && parsedTitle) {
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
      return undefined;
    }
    // if (
    //   !titleMatchHelper(parsed, metadata) &&
    //   !titleMatchHelper(parsedTorrentOrNZB, metadata)
    // ) {
    //   logger.debug(
    //     `Title ${torrentOrNZB.title} and ${bestMatch.file.name} does not match ${metadata.titles.join(', ')}, skipping...`
    //   );
    //   return undefined;
    // }
  }

  return bestMatch.file;
}

export function isVideoFile(file: DebridFile): boolean {
  const videoExtensions = [
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

  return (
    file.mimeType?.includes('video') ||
    videoExtensions.some((ext) => file.name?.endsWith(ext) ?? false)
  );
}
