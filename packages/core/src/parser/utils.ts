import { extract, FuzzballExtractOptions } from 'fuzzball';
import { createLogger } from '../utils/index.js';
import { MetadataTitle } from '../metadata/utils.js';

const logger = createLogger('parser');

const umlautMap: Record<string, string> = {
  Ä: 'Ae',
  ä: 'ae',
  Ö: 'Oe',
  ö: 'oe',
  Ü: 'Ue',
  ü: 'ue',
  ß: 'ss',
};

type TitleMatchOptions = {
  threshold: number;
  limitTitles?: number;
} & Exclude<FuzzballExtractOptions, 'returnObjects'>;

interface TitleMatchInnerResult {
  matched: boolean;
  matchedIndex?: number;
}

/**
 * Inner matching function shared by titleMatch and titleMatchWithLang.
 * Returns the match result and the index of the best matching title.
 */
function _titleMatchInner(
  parsedTitle: string,
  titles: string[],
  options: TitleMatchOptions
): TitleMatchInnerResult {
  const { threshold, limitTitles, ...extractOptions } = options;

  if (limitTitles && titles.length > limitTitles) {
    titles = titles.slice(0, limitTitles);
  }

  // when threshold is 1, no need to use levenshtein distance, just check for exact matches
  if (threshold === 1 && !extractOptions.scorer) {
    const idx = titles.findIndex(
      (title) => title.toLowerCase() === parsedTitle.toLowerCase()
    );
    return { matched: idx !== -1, matchedIndex: idx !== -1 ? idx : undefined };
  }

  const results = extract(parsedTitle, titles, {
    ...extractOptions,
    returnObjects: true,
  }) as { choice: string; score: number; key: number }[];

  let bestScore = 0;
  let bestKey: number | undefined;
  for (const result of results) {
    if (result.score > bestScore) {
      bestScore = result.score;
      bestKey = result.key;
    }
  }

  const matched = bestScore / 100 >= threshold;
  return { matched, matchedIndex: matched ? bestKey : undefined };
}

/**
 * Check if a parsed title matches any of the provided titles.
 * @returns true if a match is found above the threshold.
 */
export function titleMatch(
  parsedTitle: string,
  titles: string[],
  options: TitleMatchOptions
): boolean {
  return _titleMatchInner(parsedTitle, titles, options).matched;
}

/**
 * Like titleMatch, but accepts MetadataTitle[] and returns the language
 * of the best matching title (if any). Normalises MetadataTitle strings
 * internally so callers only need to normalise parsedTitle.
 */
export function titleMatchWithLang(
  parsedTitle: string,
  titles: MetadataTitle[],
  options: TitleMatchOptions
): { matched: boolean; language?: string } {
  const normalisedTitles = titles.map((t) => normaliseTitle(t.title));
  const result = _titleMatchInner(parsedTitle, normalisedTitles, options);
  return {
    matched: result.matched,
    language:
      result.matchedIndex !== undefined
        ? titles[result.matchedIndex]?.language
        : undefined,
  };
}

export function preprocessTitle(
  parsedTitle: string,
  filename: string,
  titles: string[]
) {
  let preprocessedTitle = parsedTitle;

  const separatorPatterns = [
    /\s*[\/\|]\s*/,
    /[\s\.\-\(]+a[\s\.]?k[\s\.]?a[\s\.\)\-]+/i,
    /\s*\(([^)]+)\)$/,
  ];
  for (const pattern of separatorPatterns) {
    const match = preprocessedTitle.match(pattern);

    if (match) {
      // if more than 20% of titles contain the separator pattern, consider it common and do not split
      const hasExistingTitleWithSeparator =
        titles.filter((title) => pattern.test(title.toLowerCase())).length /
          titles.length >
        0.2;

      if (!hasExistingTitleWithSeparator) {
        const parts = preprocessedTitle.split(pattern);
        if (parts.length > 1 && parts[0]?.trim()) {
          const originalTitle = preprocessedTitle;
          preprocessedTitle = parts[0].trim();
          logger.silly(
            `Updated title from "${originalTitle}" to "${preprocessedTitle}"`
          );
          break;
        }
      }
    }
  }

  if (
    titles.some((title) => title.toLowerCase().includes('saga')) &&
    filename?.toLowerCase().includes('saga') &&
    !preprocessedTitle.toLowerCase().includes('saga')
  ) {
    preprocessedTitle += ' Saga';
  }

  return preprocessedTitle;
}

export function normaliseTitle(title: string) {
  return title
    .replace(/[ÄäÖöÜüß]/g, (c) => umlautMap[c])
    .replace(/&/g, 'and')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}+]/gu, '')
    .toLowerCase();
}

export function cleanTitle(title: string) {
  // replace German umlauts with ASCII equivalents, then normalize to NFD
  let cleaned = title
    .replace(/[ÄäÖöÜüß]/g, (c) => umlautMap[c])
    .normalize('NFD');

  for (const char of ['♪', '♫', '★', '☆', '♡', '♥', '-']) {
    cleaned = cleaned.replaceAll(char, ' ');
  }

  return cleaned
    .replace(/&/g, 'and')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, '') // Remove remaining special chars
    .replace(/\s+/g, ' ') // Normalise spaces
    .toLowerCase()
    .trim();
}

export function parseDuration(
  durationString: string,
  output: 'ms' | 's' = 'ms'
): number | undefined {
  // Regular expression to match different formats of time durations
  const regex =
    /(?<![^\s\[(_\-,.])(?:(\d+)h[:\s]?(\d+)m[:\s]?(\d+)s|(\d+)h[:\s]?(\d+)m|(\d+)m[:\s]?(\d+)s|(\d+)h|(\d+)m|(\d+)s)(?=[\s\)\]_.\-,]|$)/gi;

  const match = regex.exec(durationString);
  if (!match) {
    return 0;
  }

  const hours = parseInt(match[1] || match[4] || match[8] || '0', 10);
  const minutes = parseInt(
    match[2] || match[5] || match[6] || match[9] || '0',
    10
  );
  const seconds = parseInt(match[3] || match[7] || match[10] || '0', 10);

  // Convert to milliseconds
  const totalMilliseconds = (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (output === 's') {
    return Math.floor(totalMilliseconds / 1000);
  }

  return totalMilliseconds;
}

export function parseAgeString(ageString: string): number | undefined {
  const match = ageString.match(/^(\d+)([a-zA-Z])$/);
  if (!match) {
    return undefined;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
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

export function parseBitrate(bitrateString: string): number | undefined {
  const match = bitrateString.match(
    /^(\d+(\.\d+)?)\s*(bps|kbps|mbps|gbps|tbps)$/i
  );
  if (!match) {
    const trimmed = bitrateString.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      return undefined;
    }
    return parseFloat(trimmed);
  }
  const num = parseFloat(match[1]);
  const unit = match[3].toLowerCase();
  switch (unit) {
    case 'bps':
      return num;
    case 'kbps':
      return num * 1000;
    case 'mbps':
      return num * 1000000;
    case 'gbps':
      return num * 1000000000;
    case 'tbps':
      return num * 1000000000000;
    default:
      return num;
  }
}
