export interface NewshostingMediaRequest {
  type: 'movie' | 'series';
  season?: number;
  episode?: number;
}

export interface NewshostingMediaMetadata {
  title?: string;
  aliases?: string[];
  year?: number;
  countries?: string[];
  isAnime?: boolean;
}

export interface ParsedNewshostingRelease {
  resolution: '2160p' | '1080p' | '720p' | '480p' | 'unknown';
  quality: 'REMUX' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'unknown';
  codec: 'x265' | 'x264' | 'AV1' | 'unknown';
  hdr: 'HDR10' | 'DV' | 'HDR10+' | 'none' | 'unknown';
  audio?: string;
  releaseGroup?: string;
  normalizedTitle: string;
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  episodeRange?: { start: number; end: number };
  seasonPack?: boolean;
  sizeBytes?: number;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSizeBytes(title: string): number | undefined {
  const match = title.match(/(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)\b/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(
    value * (match[2].toLowerCase().startsWith('g') ? 1_073_741_824 : 1_048_576)
  );
}

function normalizeReleaseTitle(title: string, releaseGroup?: string): string {
  let normalized = title;
  if (releaseGroup) {
    const escaped = releaseGroup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(
      new RegExp(`(?:[-_.\\s]|\\[)${escaped}(?:\\])?$`, 'i'),
      ' '
    );
  }
  return normalized
    .replace(/\[[^\]]+\]|\([^)]+\)/g, ' ')
    .replace(
      /\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10\+?|hdr|dv|dovi|dolby vision|remux|blu-?ray|web-?dl|webrip|hdtv|x26[45]|h26[45]|hevc|avc|av1|aac|ac3|eac3|ddp?5\.1|ddp?7\.1|atmos|truehd|dts(?:[.\s-]*hd)?(?:[.\s-]*ma)?|ma|flac|proper|repack|internal|multi|subbed|dubbed|dual audio|complete|season\s*\d{1,2}|season|pack|mkv|mp4|avi|rar|7z|zip)\b/gi,
      ' '
    )
    .replace(/\bs\d{1,2}(?:[\s._-]*e\d{1,3}(?:[\s._-]*e\d{1,3})?)?\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
    .replace(/\b(?:ep|episode)\s*\d{1,4}\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:gb|gib|mb|mib)\b/gi, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[-_.]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function parseNewshostingRelease(
  title: string
): ParsedNewshostingRelease {
  let resolution: ParsedNewshostingRelease['resolution'] = 'unknown';
  if (/\b(?:2160p|4k|uhd)\b/i.test(title)) resolution = '2160p';
  else if (/\b1080p\b/i.test(title)) resolution = '1080p';
  else if (/\b720p\b/i.test(title)) resolution = '720p';
  else if (/\b480p\b/i.test(title)) resolution = '480p';

  let quality: ParsedNewshostingRelease['quality'] = 'unknown';
  if (/\bremux\b/i.test(title)) quality = 'REMUX';
  else if (/\bblu-?ray\b/i.test(title)) quality = 'BluRay';
  else if (/\bweb-?dl\b/i.test(title)) quality = 'WEB-DL';
  else if (/\bwebrip\b/i.test(title)) quality = 'WEBRip';
  else if (/\bhdtv\b/i.test(title)) quality = 'HDTV';

  let codec: ParsedNewshostingRelease['codec'] = 'unknown';
  if (/\b(?:x265|h265|hevc)\b/i.test(title)) codec = 'x265';
  else if (/\b(?:x264|h264|avc)\b/i.test(title)) codec = 'x264';
  else if (/\bav1\b/i.test(title)) codec = 'AV1';

  let hdr: ParsedNewshostingRelease['hdr'] = 'none';
  if (/(?:^|[\s._-])(?:hdr10\+|hdr10plus)(?:$|[\s._-])/i.test(title))
    hdr = 'HDR10+';
  else if (/\b(?:dv|dovi|dolby vision)\b/i.test(title)) hdr = 'DV';
  else if (/\bhdr(?:10)?\b/i.test(title)) hdr = 'HDR10';

  const audioMatch = title.match(
    /\b(?:truehd(?:[.\s-]*atmos)?|atmos|dts[.\s-]*hd(?:[.\s-]*ma)?|dts|ddp?7\.1|ddp?5\.1|eac3|ac3|aac|flac)\b/i
  );
  const releaseGroupMatch =
    title.match(/(?:^|[-_.\s])([A-Za-z0-9]{2,})$/) ||
    title.match(/\[([A-Za-z0-9]{2,})\]\s*$/);
  const sxeMatch = title.match(
    /\bS(\d{1,2})[\s._-]*E(\d{1,3})(?:[\s._-]*E?(\d{1,3}))?\b/i
  );
  const xMatch = title.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const seasonEpisodeMatch = title.match(
    /\bSeason\s*(\d{1,2}).*?\b(?:Episode|Ep)\s*(\d{1,3})\b/i
  );
  const seasonOnlyMatch = title.match(/\bS(?:eason)?\s*(\d{1,2})\b/i);
  const absoluteMatches = [
    ...title.matchAll(
      /(?:^|[\s._-])(?:E(?:P|pisode)?\s*)?(\d{2,4})(?:\s*[-~]\s*(\d{2,4}))?(?=$|[\s._\[\]-])/gi
    ),
  ];
  const seasonPack =
    !sxeMatch &&
    (/\b(?:complete|season\s*\d{1,2}|s\d{1,2})\b.*\b(?:season|pack|complete)\b/i.test(
      title
    ) || /\bS\d{1,2}\b(?![\s._-]*E\d{1,3})/i.test(title));

  const season = parseNumber(
    sxeMatch?.[1] ||
      xMatch?.[1] ||
      seasonEpisodeMatch?.[1] ||
      seasonOnlyMatch?.[1]
  );
  const episode = parseNumber(
    sxeMatch?.[2] || xMatch?.[2] || seasonEpisodeMatch?.[2]
  );
  const absoluteMatch = absoluteMatches.find((match) => {
    const value = parseNumber(match[1]);
    if (!value || (value >= 1900 && value <= 2099)) return false;
    const end = (match.index ?? 0) + match[0].length;
    if (title[end] === '.' && /\d/.test(title[end + 1] || '')) {
      return /^(?:2160p|1080p|720p|480p)\b/i.test(title.slice(end + 1));
    }
    return true;
  });
  const rangeEnd = parseNumber(sxeMatch?.[3]);
  const absoluteEpisode = episode ? undefined : parseNumber(absoluteMatch?.[1]);
  const absoluteRangeEnd = parseNumber(absoluteMatch?.[2]);
  const rangeStart = episode || absoluteEpisode;
  const finalRangeEnd = rangeEnd || absoluteRangeEnd;
  const episodeRange =
    finalRangeEnd && rangeStart
      ? { start: rangeStart, end: finalRangeEnd }
      : undefined;
  const candidateGroup = releaseGroupMatch?.[1];
  const releaseGroup =
    candidateGroup &&
    !/^(?:2160p|1080p|720p|480p|4k|uhd|hevc|x265|x264|h264|h265|avc|av1|webdl|webrip|bluray|remux|dv|dovi|hdr|hdr10|aac|ac3|eac3|dts|truehd|atmos)$/i.test(
      candidateGroup
    )
      ? candidateGroup
      : undefined;
  let normalizedTitle = normalizeReleaseTitle(title, releaseGroup);
  if (absoluteEpisode) {
    normalizedTitle = normalizedTitle
      .replace(new RegExp(`\\b0*${absoluteEpisode}\\b`, 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return {
    resolution,
    quality,
    codec,
    hdr,
    audio: audioMatch?.[0],
    releaseGroup,
    normalizedTitle,
    season,
    episode,
    absoluteEpisode,
    episodeRange,
    seasonPack,
    sizeBytes: parseSizeBytes(title),
  };
}

export function normalizeNewshostingComparableTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019`]/g, '')
    .replace(/\b(?:[A-Za-z][.*]){2,}[A-Za-z]\b/g, (acronym) =>
      acronym.replace(/[.*]/g, '')
    )
    .replace(/&/g, ' and ')
    .replace(/\b(?:the|a|an)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function tokens(value: string): string[] {
  return normalizeNewshostingComparableTitle(value)
    .split(' ')
    .filter((token) => token.length > 1 || /^\d$/.test(token));
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function releaseTitleStem(rawTitle: string): string {
  return rawTitle
    .replace(/\bS\d{1,2}\s*E\d{1,3}.*$/i, ' ')
    .replace(/\b\d{1,2}x\d{1,3}.*$/i, ' ')
    .replace(/\bSeason\s*\d{1,2}.*$/i, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(
      /\b(?:2160p|1080p|720p|480p|4k|uhd|web-?dl|webrip|hdtv|blu-?ray|remux).*/i,
      ' '
    )
    .replace(/[-_.]+/g, ' ')
    .trim();
}

function bestTitleSimilarity(
  parsed: ParsedNewshostingRelease,
  rawTitle: string,
  metadata?: NewshostingMediaMetadata
): number {
  const titles = [metadata?.title, ...(metadata?.aliases || [])].filter(
    (title): title is string => Boolean(title)
  );
  if (!titles.length) return 0.5;
  const stem = releaseTitleStem(rawTitle);
  return Math.max(
    ...titles.map((title) =>
      Math.max(
        titleSimilarity(parsed.normalizedTitle, title),
        titleSimilarity(rawTitle, title),
        titleSimilarity(stem, title)
      )
    )
  );
}

function metadataContains(
  metadata: NewshostingMediaMetadata | undefined,
  phrase: string
): boolean {
  return [metadata?.title, ...(metadata?.aliases || [])]
    .filter((value): value is string => Boolean(value))
    .some((value) =>
      normalizeNewshostingComparableTitle(value).includes(phrase)
    );
}

function animeUniversePenalty(
  rawTitle: string,
  metadata?: NewshostingMediaMetadata
): { penalty: number; reasons: string[] } {
  if (!metadata?.isAnime) return { penalty: 0, reasons: [] };
  const normalizedRaw = normalizeNewshostingComparableTitle(rawTitle);
  const conflicts = [
    'shippuden',
    'boruto',
    'rock lee',
    'ninja pals',
    'spin off',
    'brotherhood',
    'dragon ball z',
    'dragon ball daima',
    'dragon ball gt',
    'dragon ball kai',
    'dragon ball super',
    'live action',
  ].filter(
    (term) => normalizedRaw.includes(term) && !metadataContains(metadata, term)
  );
  return {
    penalty: conflicts.length * 1200,
    reasons: conflicts.map((term) => `anime-conflict:${term}`),
  };
}

export function scoreNewshostingReleaseMatch(
  rawTitle: string,
  media: NewshostingMediaRequest,
  parsed = parseNewshostingRelease(rawTitle),
  metadata?: NewshostingMediaMetadata
): { score: number; reason: string } {
  const similarity = bestTitleSimilarity(parsed, rawTitle, metadata);
  let score = Math.round(similarity * 500);
  const reasons: string[] = [];

  if (similarity >= 0.8) {
    score += 500;
    reasons.push('title');
  } else if (similarity >= 0.45) {
    score += 220;
    reasons.push('partial-title');
  } else {
    reasons.push('weak-title');
  }

  if (media.type === 'series') {
    const releaseYear = Number.parseInt(
      rawTitle.match(/\b(?:19|20)\d{2}\b/)?.[0] || '',
      10
    );
    if (metadata?.year && Number.isFinite(releaseYear)) {
      if (releaseYear === metadata.year) {
        score += 180;
        reasons.push('year');
      } else {
        score -= metadata.isAnime ? 900 : 320;
        reasons.push('year-mismatch');
      }
    }

    const normalizedRaw = normalizeNewshostingComparableTitle(rawTitle);
    const countries = (metadata?.countries || []).map((country) =>
      country.toLowerCase()
    );
    const isUsSeries = countries.some(
      (country) =>
        country.includes('united states') ||
        country === 'us' ||
        country === 'usa'
    );
    if (isUsSeries && /\b(?:us|u s|usa)\b/.test(normalizedRaw)) {
      score += 120;
      reasons.push('country');
    }

    const animePenalty = animeUniversePenalty(rawTitle, metadata);
    score -= animePenalty.penalty;
    reasons.push(...animePenalty.reasons);

    const seasonMatches =
      parsed.season === media.season || parsed.season === undefined;
    const directEpisode = parsed.episode === media.episode;
    const rangeEpisode = Boolean(
      parsed.episodeRange &&
        media.episode &&
        parsed.episodeRange.start <= media.episode &&
        parsed.episodeRange.end >= media.episode
    );

    if (parsed.season === media.season && directEpisode) {
      score += 500;
      reasons.push('episode');
    } else if (seasonMatches && rangeEpisode) {
      score += 360;
      reasons.push('episode-range');
    } else if (parsed.season === media.season && parsed.seasonPack) {
      score += 260;
      reasons.push('season-pack');
    } else if (parsed.absoluteEpisode === media.episode) {
      score += metadata?.isAnime ? 480 : 190;
      reasons.push('absolute-episode');
    } else if (
      parsed.episode !== undefined ||
      parsed.season !== undefined ||
      parsed.absoluteEpisode !== undefined
    ) {
      score -= metadata?.isAnime ? 1000 : 250;
      reasons.push('episode-mismatch');
    } else {
      score -= 80;
      reasons.push('uncertain-episode');
    }
  }

  return { score: Math.max(0, score), reason: reasons.join(',') };
}
