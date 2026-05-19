import {
  AIOStreamsAnimeEntry,
  AIOStreamsSearchApiResult,
  ParsedId,
} from './aiostreams';

export function buildMagnetLink(
  result: AIOStreamsSearchApiResult
): string | null {
  if (!result.infoHash) return null;

  let magnet = `magnet:?xt=urn:btih:${result.infoHash}`;
  const torrentName = result.folderName ?? result.filename;
  if (torrentName) magnet += `&dn=${encodeURIComponent(torrentName)}`;
  if (result.sources) {
    result.sources
      .filter((src) => !src.startsWith('dht:'))
      .forEach((src) => {
        const tr = src.startsWith('tracker:')
          ? src.slice('tracker:'.length)
          : src;
        magnet += `&tr=${encodeURIComponent(tr)}`;
      });
  }
  return magnet;
}

export function getSeasonFromSynonyms(synonyms: string[]): number | undefined {
  const seasonRegex = /(?:season|s)\s(\d+)/i;
  for (const synonym of synonyms) {
    const match = synonym.match(seasonRegex);
    if (match) return Number(match[1].trim());
  }
  return undefined;
}

export function enrichParsedIdWithAnimeEntry(
  parsedId: ParsedId,
  animeEntry: AIOStreamsAnimeEntry
): void {
  let episodeOffsetApplied = false;
  const imdbId = animeEntry?.mappings?.imdbId;
  if (
    parsedId.episode &&
    animeEntry?.episodeMappings &&
    animeEntry.episodeMappings.length > 0
  ) {
    const episodeNum = Number(parsedId.episode);
    const mapping = animeEntry.episodeMappings.find(
      (m) =>
        m.start !== undefined &&
        m.end !== undefined &&
        episodeNum >= m.start &&
        episodeNum <= m.end
    );
    if (mapping) {
      const mappedSeason = mapping.tvdbSeason;
      const shouldApplyEpisodeOffset = imdbId && ['tt1528406'].includes(imdbId);
      if (
        mappedSeason &&
        shouldApplyEpisodeOffset &&
        mapping.offset !== undefined
      ) {
        parsedId.season = mappedSeason;
        parsedId.episode = episodeNum + mapping.offset;
        episodeOffsetApplied = true;
      }
    }
  }
  if (!parsedId.season) {
    parsedId.season =
      animeEntry.imdb?.seasonNumber ??
      animeEntry.trakt?.seasonNumber ??
      animeEntry.tvdb?.seasonNumber ??
      getSeasonFromSynonyms(animeEntry.synonyms ?? []) ??
      animeEntry.tmdb?.seasonNumber ??
      undefined;
  }
  if (
    parsedId.episode &&
    ['malId', 'kitsuId', 'anilistId', 'anidbId'].includes(parsedId.type) &&
    !episodeOffsetApplied
  ) {
    const fromEpisode =
      animeEntry.imdb?.fromEpisode ?? animeEntry.tvdb?.fromEpisode;
    if (fromEpisode && fromEpisode !== 1) {
      parsedId.episode = fromEpisode + Number(parsedId.episode) - 1;
    }
  }
}

export function applyPreferredMapping(
  parsedId: ParsedId,
  animeEntry: AIOStreamsAnimeEntry,
  preferred: 'imdbId' | 'kitsuId' | 'anilistId'
): ParsedId {
  if (preferred === 'kitsuId' && animeEntry.mappings?.kitsuId) {
    parsedId.type = 'kitsuId';
    parsedId.value = String(animeEntry.mappings.kitsuId);
    return parsedId;
  }
  if (preferred === 'anilistId' && animeEntry.mappings?.anilistId) {
    parsedId.type = 'anilistId';
    parsedId.value = String(animeEntry.mappings.anilistId);
    return parsedId;
  }
  if (animeEntry.mappings?.imdbId) {
    enrichParsedIdWithAnimeEntry(parsedId, animeEntry);
    parsedId.type = 'imdbId';
    parsedId.value = String(animeEntry.mappings.imdbId);
  }
  return parsedId;
}

export function formatIdForSearch(id: ParsedId): string {
  switch (id.type) {
    case 'anidbId':
      return `anidb:${id.value}`;
    case 'anilistId':
      return `anilist:${id.value}`;
    case 'malId':
      return `mal:${id.value}`;
    case 'kitsuId':
      return `kitsu:${id.value}`;
    case 'imdbId':
      return String(id.value);
    case 'stremioId':
      return String(id.value);
    default:
      return `${id.type}:${id.value}`;
  }
}
