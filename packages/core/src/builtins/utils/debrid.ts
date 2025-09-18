import {
  BuiltinServiceId,
  createLogger,
  getTimeTakenSincePoint,
} from '../../utils/index.js';
import {
  BuiltinDebridServices,
  DebridFile,
  getDebridService,
  selectFileInTorrentOrNZB,
  Torrent,
  TorrentWithSelectedFile,
  NZBWithSelectedFile,
  NZB,
  isSeasonWrong,
  isEpisodeWrong,
} from '../../debrid/index.js';
import { PTT } from '../../parser/index.js';
import { ParseResult } from 'go-ptt';

// we have a list of torrents which need to be
// - 1. checked for instant availability for each configured debrid service
// - 2. pick a file from file list if available
// - 3. return list of torrents but with service info too.

const logger = createLogger('debrid');

// export function

interface Metadata {
  titles: string[];
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
}

export function extractTrackersFromMagnet(magnet: string): string[] {
  return new URL(magnet.replace('&amp;', '&')).searchParams.getAll('tr');
}

export function extractInfoHashFromMagnet(magnet: string): string | undefined {
  return magnet
    .match(/(?:urn(?::|%3A)btih(?::|%3A))([a-f0-9]{40})/i)?.[1]
    ?.toLowerCase();
}

export async function processTorrents(
  torrents: Torrent[],
  debridServices: BuiltinDebridServices,
  stremioId: string,
  metadata?: Metadata,
  clientIp?: string
): Promise<{
  results: TorrentWithSelectedFile[];
  errors: { serviceId: BuiltinServiceId; error: Error }[];
}> {
  if (torrents.length === 0) {
    return { results: [], errors: [] };
  }
  const results: TorrentWithSelectedFile[] = [];
  const errors: { serviceId: BuiltinServiceId; error: Error }[] = [];

  // Run all service checks in parallel and collect both results and errors
  const servicePromises = debridServices.map(async (service) => {
    try {
      const serviceResults = await processTorrentsForDebridService(
        torrents,
        service,
        stremioId,
        metadata,
        clientIp
      );
      return { serviceId: service.id, results: serviceResults, error: null };
    } catch (error) {
      logger.error(
        `Error processing torrents for ${service.id}: ${error}`,
        error
      );
      return { serviceId: service.id, results: [], error };
    }
  });

  const settledResults = await Promise.all(servicePromises);

  for (const { results: serviceResults, error, serviceId } of settledResults) {
    if (serviceResults && serviceResults.length > 0) {
      results.push(...serviceResults);
    }
    if (error instanceof Error) {
      errors.push({ serviceId, error });
    }
  }

  return { results, errors };
}

async function processTorrentsForDebridService(
  torrents: Torrent[],
  service: BuiltinDebridServices[number],
  stremioId: string,
  metadata?: Metadata,
  clientIp?: string
): Promise<TorrentWithSelectedFile[]> {
  const startTime = Date.now();
  const debridService = getDebridService(
    service.id,
    service.credential,
    clientIp
  );

  const results: TorrentWithSelectedFile[] = [];

  const magnetCheckResults = await debridService.checkMagnets(
    torrents.map((torrent) => torrent.hash),
    stremioId
  );

  const allStrings: string[] = [];

  // First add all torrent titles
  for (const torrent of torrents) {
    allStrings.push(torrent.title ?? '');
  }

  // Then add all filenames from all torrents
  for (const torrent of magnetCheckResults) {
    if (torrent.files && Array.isArray(torrent.files)) {
      for (const file of torrent.files) {
        allStrings.push(file.name ?? '');
      }
    }
  }

  // Parse all strings in one call
  const allParsedResults = await PTT.parse(allStrings);

  // Split the results into parsed titles and files
  const parsedFiles = new Map<string, ParseResult>();
  for (const [index, result] of allParsedResults.entries()) {
    if (result) {
      parsedFiles.set(allStrings[index], result);
    }
  }

  for (const [index, torrent] of torrents.entries()) {
    let file: DebridFile | undefined;

    const magnetCheckResult = magnetCheckResults.find(
      (result) => result.hash === torrent.hash
    );

    const parsedTorrent = parsedFiles.get(torrent.title ?? '');
    if (metadata && parsedTorrent) {
      if (isSeasonWrong(parsedTorrent, metadata)) {
        continue;
      }
      if (isEpisodeWrong(parsedTorrent, metadata)) {
        continue;
      }
    }
    file = magnetCheckResult
      ? await selectFileInTorrentOrNZB(
          torrent,
          magnetCheckResult,
          parsedFiles,
          metadata
        )
      : { name: torrent.title, size: torrent.size, index: -1 };

    if (file) {
      results.push({
        ...torrent,
        file,
        service: {
          id: service.id,
          cached: magnetCheckResult?.status === 'cached',
          owned: false,
        },
      });
    }
  }

  logger.debug(
    `Processed ${torrents.length} torrents for ${service.id} in ${getTimeTakenSincePoint(startTime)}`
  );

  return results;
}

export async function processTorrentsForP2P(
  torrents: Torrent[],
  metadata?: Metadata
): Promise<TorrentWithSelectedFile[]> {
  const results: TorrentWithSelectedFile[] = [];

  const allStrings: string[] = [];
  for (const torrent of torrents) {
    allStrings.push(torrent.title ?? '');
    if (torrent.files && Array.isArray(torrent.files)) {
      for (const file of torrent.files) {
        allStrings.push(file.name ?? '');
      }
    }
  }

  const allParsedResults = await PTT.parse(allStrings);
  const parsedFiles = new Map<string, ParseResult>();
  for (const [index, result] of allParsedResults.entries()) {
    if (result) {
      parsedFiles.set(allStrings[index], result);
    }
  }

  for (const [index, torrent] of torrents.entries()) {
    let file: DebridFile | undefined;

    const parsedTorrent = parsedFiles.get(torrent.title ?? '');
    if (metadata && parsedTorrent) {
      if (isSeasonWrong(parsedTorrent, metadata)) {
        continue;
      }
      if (isEpisodeWrong(parsedTorrent, metadata)) {
        continue;
      }
    }
    file = torrent.files
      ? await selectFileInTorrentOrNZB(
          torrent,
          {
            id: 'p2p',
            name: torrent.title,
            size: torrent.size,
            status: 'downloaded',
            files: torrent.files,
          },
          parsedFiles,
          metadata
        )
      : undefined;

    if (file) {
      results.push({
        ...torrent,
        file,
      });
    }
  }

  return results;
}

export async function processNZBs(
  nzbs: NZB[],
  debridServices: BuiltinDebridServices,
  stremioId: string,
  metadata?: Metadata,
  clientIp?: string
): Promise<{
  results: NZBWithSelectedFile[];
  errors: { serviceId: BuiltinServiceId; error: Error }[];
}> {
  if (nzbs.length === 0) {
    return { results: [], errors: [] };
  }
  const results: NZBWithSelectedFile[] = [];
  const errors: { serviceId: BuiltinServiceId; error: Error }[] = [];

  const servicePromises = debridServices.map(async (service) => {
    try {
      const serviceResults = await processNZBsForDebridService(
        nzbs,
        service,
        stremioId,
        metadata,
        clientIp
      );
      return { serviceId: service.id, results: serviceResults, error: null };
    } catch (error) {
      logger.error(`Error processing NZBs for ${service.id}: ${error}`, error);
      return { serviceId: service.id, results: [], error };
    }
  });

  const settledResults = await Promise.all(servicePromises);

  for (const { results: serviceResults, error, serviceId } of settledResults) {
    if (serviceResults && serviceResults.length > 0) {
      results.push(...serviceResults);
    }
    if (error instanceof Error) {
      errors.push({ serviceId, error });
    }
  }

  return { results, errors };
}

async function processNZBsForDebridService(
  nzbs: NZB[],
  service: BuiltinDebridServices[number],
  stremioId: string,
  metadata?: Metadata,
  clientIp?: string
): Promise<NZBWithSelectedFile[]> {
  const startTime = Date.now();
  const debridService = getDebridService(
    service.id,
    service.credential,
    clientIp
  );

  if (!debridService.supportsUsenet || !debridService.checkNzbs) {
    throw new Error(`Service ${service.id} does not support usenet`);
  }

  const results: NZBWithSelectedFile[] = [];

  const nzbCheckResults = await debridService.checkNzbs(
    nzbs.map((nzb) => nzb.hash)
  );

  // parse all files from all nzbs in one call

  const allStrings: string[] = [];

  for (const nzb of nzbs) {
    allStrings.push(nzb.title ?? '');
  }

  for (const nzb of nzbCheckResults) {
    if (nzb.files && Array.isArray(nzb.files)) {
      for (const file of nzb.files) {
        allStrings.push(file.name ?? '');
      }
    }
  }

  const allParsedResults = await PTT.parse(allStrings);
  const parsedFiles = new Map<string, ParseResult>();
  for (const [index, result] of allParsedResults.entries()) {
    if (result) {
      parsedFiles.set(allStrings[index], result);
    }
  }

  for (const [index, nzb] of nzbs.entries()) {
    let file: DebridFile | undefined;

    const nzbCheckResult = nzbCheckResults.find(
      (result) => result.hash === nzb.hash
    );
    const parsedNzb = parsedFiles.get(nzb.title ?? '');
    if (metadata && parsedNzb) {
      if (isSeasonWrong(parsedNzb, metadata)) {
        continue;
      }
      if (isEpisodeWrong(parsedNzb, metadata)) {
        continue;
      }
    }
    file = nzbCheckResult
      ? await selectFileInTorrentOrNZB(
          nzb,
          nzbCheckResult,
          parsedFiles,
          metadata
        )
      : { name: nzb.title, size: nzb.size, index: -1 };

    if (file) {
      results.push({
        ...nzb,
        file,
        service: {
          id: service.id,
          cached: nzbCheckResult?.status === 'cached',
          owned: false,
        },
      });
    }
  }

  logger.debug(
    `Processed ${nzbs.length} NZBs for ${service.id} in ${getTimeTakenSincePoint(startTime)}`
  );

  return results;
}
