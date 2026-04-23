import {
  BuiltinServiceId,
  createLogger,
  getTimeTakenSincePoint,
  mergeParsedMediaInfos,
  parseMediaInfo,
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
  isTitleWrong,
  DebridDownload,
  isNotVideoFile,
  isTorrentDebridService,
  isUsenetDebridService,
  TitleMetadata,
  hashNzbUrl,
} from '../../debrid/index.js';
import { parseTorrentTitle, ParsedResult } from '@viren070/parse-torrent-title';
import {
  preprocessTitle,
  normaliseTitle,
  extractInfoHashFromMagnet,
} from '../../parser/utils.js';
export { extractInfoHashFromMagnet };

const logger = createLogger('debrid');

type Metadata = TitleMetadata;

export function validateInfoHash(
  infoHash: string | undefined
): string | undefined {
  return infoHash && /^[a-f0-9]{40}$/i.test(infoHash)
    ? infoHash.toLowerCase()
    : undefined;
}

export function extractTrackersFromMagnet(magnet: string): string[] {
  return new URL(magnet.replace('&amp;', '&')).searchParams
    .getAll('tr')
    .filter((tracker) => tracker.trim() !== '');
}

export async function processTorrents(
  torrents: Torrent[],
  debridServices: BuiltinDebridServices,
  stremioId: string,
  metadata?: Metadata,
  clientIp?: string,
  checkOwned: boolean = true
): Promise<{
  results: TorrentWithSelectedFile[];
  errors: { serviceId: BuiltinServiceId; error: Error }[];
  serviceTimings: Record<
    string,
    {
      magnetCheckMs: number;
      processingMs: number;
      totalMs: number;
      cachedCount: number;
      uncachedCount: number;
      torrentsIn: number;
    }
  >;
}> {
  if (torrents.length === 0) {
    return { results: [], errors: [], serviceTimings: {} };
  }
  const results: TorrentWithSelectedFile[] = [];
  const errors: { serviceId: BuiltinServiceId; error: Error }[] = [];

  // Pre-compute title parsing once, shared across all parallel service calls.
  const sharedParsedTitlesMap = new Map<string, ParsedResult>();
  for (const t of torrents) {
    const key = t.title ?? '';
    if (!sharedParsedTitlesMap.has(key)) {
      sharedParsedTitlesMap.set(key, parseTorrentTitle(key));
    }
  }

  // Run all service checks in parallel and collect both results and errors
  const servicePromises = debridServices.map(async (service) => {
    try {
      const serviceResult = await processTorrentsForDebridService(
        torrents,
        service,
        stremioId,
        metadata,
        clientIp,
        checkOwned,
        sharedParsedTitlesMap
      );
      return { serviceId: service.id, ...serviceResult, error: null };
    } catch (error) {
      if (error instanceof Error && error.stack) {
        delete error.stack;
      }
      logger.error(`Error processing torrents for ${service.id}:`, error);
      return {
        serviceId: service.id,
        results: [],
        error,
        magnetCheckMs: 0,
        processingMs: 0,
        totalMs: 0,
        cachedCount: 0,
        uncachedCount: 0,
        torrentsIn: torrents.length,
      };
    }
  });

  const settledResults = await Promise.all(servicePromises);

  const serviceTimings: Record<
    string,
    {
      magnetCheckMs: number;
      processingMs: number;
      totalMs: number;
      cachedCount: number;
      uncachedCount: number;
      torrentsIn: number;
      hasError?: boolean;
    }
  > = {};

  for (const {
    results: serviceResults,
    error,
    serviceId,
    magnetCheckMs,
    processingMs,
    totalMs,
    cachedCount,
    uncachedCount,
    torrentsIn,
  } of settledResults) {
    if (serviceResults && serviceResults.length > 0) {
      results.push(...serviceResults);
    }
    if (error instanceof Error) {
      errors.push({ serviceId, error });
    }
    serviceTimings[serviceId] = {
      magnetCheckMs,
      processingMs,
      totalMs,
      cachedCount,
      uncachedCount,
      torrentsIn,
      hasError: !!error,
    };
  }

  return { results, errors, serviceTimings };
}

async function processTorrentsForDebridService(
  torrents: Torrent[],
  service: BuiltinDebridServices[number],
  stremioId: string,
  metadata?: Metadata,
  clientIp?: string,
  checkOwned: boolean = true,
  sharedParsedTitlesMap?: Map<string, ParsedResult>
): Promise<{
  results: TorrentWithSelectedFile[];
  magnetCheckMs: number;
  processingMs: number;
  totalMs: number;
  cachedCount: number;
  uncachedCount: number;
  torrentsIn: number;
}> {
  const startTime = Date.now();
  const debridService = getDebridService(
    service.id,
    service.credential,
    clientIp
  );
  if (!isTorrentDebridService(debridService)) {
    logger.warn(
      `Service ${service.id} does not support torrents, skipping torrent processing`
    );
    return {
      results: [],
      magnetCheckMs: 0,
      processingMs: 0,
      totalMs: 0,
      cachedCount: 0,
      uncachedCount: 0,
      torrentsIn: 0,
    };
  }

  // Filter out library items that belong to a different service
  torrents = torrents.filter(
    (t) => !t.library || !t.indexer || t.indexer === service.id
  );

  if (torrents.length === 0) {
    return {
      results: [],
      magnetCheckMs: 0,
      processingMs: 0,
      totalMs: 0,
      cachedCount: 0,
      uncachedCount: 0,
      torrentsIn: 0,
    };
  }

  const results: TorrentWithSelectedFile[] = [];

  const magnetCheckResults = await debridService.checkMagnets(
    torrents.map((torrent) => torrent.hash),
    stremioId,
    checkOwned
  );
  const magnetCheckMs = Date.now() - startTime;
  const magnetCheckTime = getTimeTakenSincePoint(startTime);
  logger.debug(`Retrieved magnet status from debrid`, {
    service: debridService.serviceName,
    magnetCount: torrents.length,
    cached: magnetCheckResults.filter((r) => r.status === 'cached').length,
    time: magnetCheckTime,
  });

  // Parse titles and validate
  let parsedTitlesMap: Map<string, ParsedResult>;
  if (sharedParsedTitlesMap) {
    parsedTitlesMap = sharedParsedTitlesMap;
  } else {
    parsedTitlesMap = new Map<string, ParsedResult>();
    for (const torrent of torrents) {
      const key = torrent.title ?? '';
      if (!parsedTitlesMap.has(key)) {
        parsedTitlesMap.set(key, parseTorrentTitle(key));
      }
    }
  }

  // Build O(1) hash lookup
  const magnetCheckMap = new Map<string, DebridDownload>();
  for (const result of magnetCheckResults) {
    if (result.hash) magnetCheckMap.set(result.hash, result);
  }

  const normTitles: Set<string> | null = metadata?.titles?.length
    ? new Set(metadata.titles.map(normaliseTitle))
    : null;
  const titleCache = new Map<string, string>();

  // Filter torrents that pass validation checks
  let filteredFailed = 0,
    filteredTitle = 0,
    filteredSeason = 0,
    filteredEpisode = 0;
  const validTorrents: {
    torrent: Torrent;
    magnetCheckResult: DebridDownload | undefined;
    parsedTitle: ParsedResult;
  }[] = [];
  for (const torrent of torrents) {
    const magnetCheckResult = magnetCheckMap.get(torrent.hash);
    if (magnetCheckResult?.status === 'failed') {
      filteredFailed++;
      continue;
    }
    const parsedTorrent = parsedTitlesMap.get(
      torrent.title ?? magnetCheckResult?.name ?? ''
    );

    if (metadata && parsedTorrent) {
      const parsedTitleKey = parsedTorrent.title ?? '';
      let preprocessedTitle = titleCache.get(parsedTitleKey);
      if (preprocessedTitle === undefined) {
        preprocessedTitle = preprocessTitle(
          parsedTitleKey,
          torrent.title ?? magnetCheckResult?.name ?? '',
          metadata.titles
        );
        titleCache.set(parsedTitleKey, preprocessedTitle);
      }
      if (torrent.confirmed !== true) {
        if (normTitles !== null) {
          const normParsed = normaliseTitle(preprocessedTitle);
          const exactMatch = normTitles.has(normParsed);
          if (
            !exactMatch &&
            isTitleWrong({ title: preprocessedTitle }, metadata)
          ) {
            filteredTitle++;
            continue;
          }
        }
      }
      if (isSeasonWrong(parsedTorrent, metadata)) {
        filteredSeason++;
        continue;
      }
      if (isEpisodeWrong(parsedTorrent, metadata)) {
        filteredEpisode++;
        continue;
      }
    }

    validTorrents.push({
      torrent,
      magnetCheckResult,
      parsedTitle: parsedTorrent!,
    });
  }

  // Parse files only for valid torrents
  const allFileStrings: string[] = [];
  for (const { magnetCheckResult } of validTorrents) {
    if (magnetCheckResult?.files && Array.isArray(magnetCheckResult.files)) {
      for (const file of magnetCheckResult.files) {
        if (isNotVideoFile(file)) continue;
        allFileStrings.push(file.name ?? '');
      }
    }
  }

  // Parse all file strings in one call
  const allParsedFiles: ParsedResult[] = allFileStrings.map((string) =>
    parseTorrentTitle(string)
  );
  const parsedFiles = new Map<string, ParsedResult>();
  for (const [index, result] of allParsedFiles.entries()) {
    parsedFiles.set(allFileStrings[index], result);
  }

  for (const [title, parsed] of parsedTitlesMap.entries()) {
    parsedFiles.set(title, parsed);
  }

  logger.debug(`Parsed file strings for debrid`, {
    service: service.id,
    validTorrents: validTorrents.length,
    totalFileStrings: allFileStrings.length,
  });

  for (let i = 0; i < validTorrents.length; i++) {
    const { torrent, magnetCheckResult, parsedTitle } = validTorrents[i];
    let file: DebridFile | undefined;

    file = magnetCheckResult
      ? await selectFileInTorrentOrNZB(
          torrent,
          magnetCheckResult,
          parsedFiles,
          metadata,
          {
            useLevenshteinMatching: false,
            skipSeasonEpisodeCheck: torrent.confirmed,
          }
        )
      : { name: torrent.title, size: torrent.size, index: -1 };

    if (file) {
      const parsedMediaInfo = mergeParsedMediaInfos(
        parseMediaInfo(file.mediaInfo),
        torrent.parsedMediaInfo
      );

      results.push({
        ...torrent,
        title: torrent.title ?? magnetCheckResult?.name,
        size: magnetCheckResult?.size || torrent.size,
        indexer: torrent.library ? undefined : torrent.indexer,
        file,
        parsedMediaInfo,
        service: {
          id: service.id,
          cached:
            magnetCheckResult?.status === 'cached' ||
            (magnetCheckResult?.library || torrent.library) === true,
          library: (magnetCheckResult?.library || torrent.library) === true,
        },
      });
    }
  }

  logger.debug(`Finished processing of torrents`, {
    service: service.id,
    torrents: torrents.length,
    validTorrents: validTorrents.length,
    finalTorrents: results.length,
    totalTime: getTimeTakenSincePoint(startTime),
    checkTime: magnetCheckTime,
  });

  const totalMs = Date.now() - startTime;
  const cachedCount = results.filter((r) => r.service?.cached === true).length;
  const uncachedCount = results.filter(
    (r) => r.service?.cached === false
  ).length;
  return {
    results,
    magnetCheckMs,
    processingMs: totalMs - magnetCheckMs,
    totalMs,
    cachedCount,
    uncachedCount,
    torrentsIn: torrents.length,
  };
}

export async function processTorrentsForP2P(
  torrents: Torrent[],
  metadata?: Metadata
): Promise<TorrentWithSelectedFile[]> {
  const results: TorrentWithSelectedFile[] = [];

  // Parse only torrent titles and perform validation checks
  const torrentTitles = torrents.map((torrent) => torrent.title ?? '');
  const parsedTitles: ParsedResult[] = torrentTitles.map((title) =>
    parseTorrentTitle(title)
  );
  const parsedTitlesMap = new Map<string, ParsedResult>();
  for (const [index, result] of parsedTitles.entries()) {
    parsedTitlesMap.set(torrentTitles[index], result);
  }

  // Filter torrents that pass validation checks
  const validTorrents: { torrent: Torrent; parsedTitle: ParsedResult }[] = [];
  for (const torrent of torrents) {
    const parsedTorrent = parsedTitlesMap.get(torrent.title ?? '');
    if (metadata && parsedTorrent) {
      if (isSeasonWrong(parsedTorrent, metadata)) {
        continue;
      }
      if (isEpisodeWrong(parsedTorrent, metadata)) {
        continue;
      }
    }
    validTorrents.push({ torrent, parsedTitle: parsedTorrent! });
  }

  // Parse files only for valid torrents
  const allFileStrings: string[] = [];
  for (const { torrent } of validTorrents) {
    if (torrent.files && Array.isArray(torrent.files)) {
      for (const file of torrent.files) {
        if (isNotVideoFile(file)) continue;
        allFileStrings.push(file.name ?? '');
      }
    }
  }

  const allParsedFiles: ParsedResult[] = allFileStrings.map((string) =>
    parseTorrentTitle(string)
  );
  const parsedFiles = new Map<string, ParsedResult>();
  for (const [index, result] of allParsedFiles.entries()) {
    parsedFiles.set(allFileStrings[index], result);
  }

  for (const { torrent } of validTorrents) {
    let file: DebridFile | undefined;

    file = torrent.files
      ? await selectFileInTorrentOrNZB(
          torrent,
          {
            id: 'p2p',
            name: torrent.title,
            private: torrent.private,
            size: torrent.size,
            status: 'downloaded',
            files: torrent.files,
          },
          parsedFiles,
          metadata,
          {
            useLevenshteinMatching: false,
          }
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
  clientIp?: string,
  checkOwned: boolean = true
): Promise<{
  results: NZBWithSelectedFile[];
  errors: { serviceId: BuiltinServiceId; error: Error }[];
}> {
  if (nzbs.length === 0) {
    return { results: [], errors: [] };
  }
  const results: NZBWithSelectedFile[] = [];
  const errors: { serviceId: BuiltinServiceId; error: Error }[] = [];

  // Pre-compute NZB title parsing once, shared across all parallel service calls.
  const sharedParsedNzbTitlesMap = new Map<string, ParsedResult>();
  for (const n of nzbs) {
    const key = n.title ?? '';
    if (!sharedParsedNzbTitlesMap.has(key)) {
      sharedParsedNzbTitlesMap.set(key, parseTorrentTitle(key));
    }
  }

  const servicePromises = debridServices.map(async (service) => {
    try {
      const serviceResults = await processNZBsForDebridService(
        nzbs,
        service,
        stremioId,
        metadata,
        clientIp,
        checkOwned,
        sharedParsedNzbTitlesMap
      );
      return { serviceId: service.id, results: serviceResults, error: null };
    } catch (error) {
      if (error instanceof Error && error.stack) {
        delete error.stack;
      }
      logger.error(`Error processing NZBs for ${service.id}:`, error);
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
  clientIp?: string,
  checkOwned: boolean = true,
  sharedParsedTitlesMap?: Map<string, ParsedResult>
): Promise<NZBWithSelectedFile[]> {
  const startTime = Date.now();
  const debridService = getDebridService(
    service.id,
    service.credential,
    clientIp
  );
  if (!isUsenetDebridService(debridService)) {
    logger.warn(
      `Service ${service.id} does not support usenet, skipping NZB processing`
    );
    return [];
  }

  nzbs = nzbs.filter(
    (n) => !n.library || !n.indexer || n.indexer === service.id
  );

  if (nzbs.length === 0) {
    return [];
  }

  const results: NZBWithSelectedFile[] = [];

  if (service.id === 'torbox') {
    // update the hashes to be the md5 of the URL without cleaning.
    // torbox still hash entire URl instead of removing query params.
    // TODO: remove once torbox hashes after cleaning.
    nzbs = nzbs.map((nzb) => {
      if (nzb.nzb) {
        const hash = hashNzbUrl(nzb.nzb, false);
        return {
          ...nzb,
          hash,
        };
      }
      return nzb;
    });
  }

  const nzbCheckResults = await debridService.checkNzbs(
    nzbs.map((nzb) => ({ name: nzb.title, hash: nzb.hash })),
    checkOwned
  );

  logger.debug(`Retrieved NZB status from debrid`, {
    service: debridService.serviceName,
    nzbCount: nzbs.length,
    time: getTimeTakenSincePoint(startTime),
  });

  // Parse NZB titles and validate
  let parsedTitlesMap: Map<string, ParsedResult>;
  if (sharedParsedTitlesMap) {
    parsedTitlesMap = sharedParsedTitlesMap;
  } else {
    parsedTitlesMap = new Map<string, ParsedResult>();
    for (const nzb of nzbs) {
      const key = nzb.title ?? '';
      if (!parsedTitlesMap.has(key)) {
        parsedTitlesMap.set(key, parseTorrentTitle(key));
      }
    }
  }

  const nzbCheckMap = new Map<string, DebridDownload>();
  for (const result of nzbCheckResults) {
    if (result.hash) nzbCheckMap.set(result.hash, result);
  }

  const normTitles: Set<string> | null = metadata?.titles?.length
    ? new Set(metadata.titles.map(normaliseTitle))
    : null;
  const titleCache = new Map<string, string>();

  // Filter NZBs that pass validation checks
  const validNZBs: {
    nzb: NZB;
    nzbCheckResult: DebridDownload | undefined;
    parsedTitle: ParsedResult;
  }[] = [];
  for (const nzb of nzbs) {
    const nzbCheckResult = nzbCheckMap.get(nzb.hash ?? '');
    if (nzbCheckResult?.status === 'failed') {
      logger.debug(`Skipping NZB as its status is failed`, {
        service: service.id,
        nzb: nzb.title,
      });
      continue;
    }
    const parsedNzb = parsedTitlesMap.get(
      nzb.title ?? nzbCheckResult?.name ?? ''
    );

    if (metadata && parsedNzb) {
      const parsedTitleKey = parsedNzb.title ?? '';
      let preprocessedTitle = titleCache.get(parsedTitleKey);
      if (preprocessedTitle === undefined) {
        preprocessedTitle = preprocessTitle(
          parsedTitleKey,
          nzb.title ?? nzbCheckResult?.name ?? '',
          metadata.titles
        );
        titleCache.set(parsedTitleKey, preprocessedTitle);
      }
      if (nzb.confirmed !== true) {
        if (normTitles !== null) {
          const normParsed = normaliseTitle(preprocessedTitle);
          const exactMatch = normTitles.has(normParsed);
          if (
            !exactMatch &&
            isTitleWrong({ title: preprocessedTitle }, metadata)
          ) {
            continue;
          }
        }
      }
      if (isSeasonWrong(parsedNzb, metadata)) {
        continue;
      }
      if (isEpisodeWrong(parsedNzb, metadata)) {
        continue;
      }
    }

    validNZBs.push({ nzb, nzbCheckResult, parsedTitle: parsedNzb! });
  }

  // Parse files only for valid NZBs
  const allFileStrings: string[] = [];
  for (const { nzbCheckResult } of validNZBs) {
    if (nzbCheckResult?.files && Array.isArray(nzbCheckResult.files)) {
      for (const file of nzbCheckResult.files) {
        if (isNotVideoFile(file)) continue;
        allFileStrings.push(file.name ?? '');
      }
    }
  }

  const allParsedFiles: ParsedResult[] = allFileStrings.map((string) =>
    parseTorrentTitle(string)
  );
  const parsedFiles = new Map<string, ParsedResult>();
  for (const [index, result] of allParsedFiles.entries()) {
    parsedFiles.set(allFileStrings[index], result);
  }

  for (const [title, parsed] of parsedTitlesMap.entries()) {
    parsedFiles.set(title, parsed);
  }

  for (const { nzb, nzbCheckResult } of validNZBs) {
    let file: DebridFile | undefined;

    file = nzbCheckResult
      ? await selectFileInTorrentOrNZB(
          nzb,
          nzbCheckResult,
          parsedFiles,
          metadata,
          {
            useLevenshteinMatching: false,
            skipSeasonEpisodeCheck: nzb.confirmed,
          }
        )
      : { name: nzb.title, size: nzb.size, index: -1 };

    if (file) {
      results.push({
        ...nzb,
        title: nzb.title ?? nzbCheckResult?.name,
        size: nzbCheckResult?.size || nzb.size,
        indexer: nzb.library ? undefined : nzb.indexer,
        file,
        service: {
          id: service.id,
          cached:
            nzbCheckResult?.status === 'cached' ||
            (nzbCheckResult?.library || nzb.library) === true,
          library: (nzbCheckResult?.library || nzb.library) === true,
        },
      });
    }
  }

  logger.debug(`Finished processing of NZBs`, {
    service: service.id,
    nzbs: nzbs.length,
    validNzbs: validNZBs.length,
    finalNzbs: results.length,
    totalTime: getTimeTakenSincePoint(startTime),
  });

  return results;
}
