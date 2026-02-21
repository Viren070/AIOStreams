import { extract, FuzzballExtractOptions } from 'fuzzball';
import { createLogger } from '../utils/index.js';

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

export function titleMatch(
  parsedTitle: string,
  titles: string[],
  options: {
    threshold: number;
    limitTitles?: number;
  } & Exclude<FuzzballExtractOptions, 'returnObjects'>
) {
  const { threshold, ...extractOptions } = options;

  // when threshold is 1, no need to use levenshtein distance, just check for exact matches
  if (threshold === 1 && !extractOptions.scorer) {
    return titles.some(
      (title) => title.toLowerCase() === parsedTitle.toLowerCase()
    );
  }

  if (options.limitTitles && titles.length > options.limitTitles) {
    titles.length = options.limitTitles;
  }

  const results = extract(parsedTitle, titles, {
    ...extractOptions,
    returnObjects: true,
  });

  const highestScore =
    results.reduce(
      (max: number, result: { choice: string; score: number; key: number }) => {
        return Math.max(max, result.score);
      },
      0
    ) / 100;

  return highestScore >= threshold;
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

export interface CleanTitleOptions {
  /** Keep apostrophes in the title (e.g. "Madea's" stays "madea's" instead of "madeas") */
  keepApostrophes?: boolean;
}

export function cleanTitle(title: string, options?: CleanTitleOptions) {
  // replace German umlauts with ASCII equivalents, then normalize to NFD
  let cleaned = title
    .replace(/[ÄäÖöÜüß]/g, (c) => umlautMap[c])
    .normalize('NFD');

  for (const char of ['♪', '♫', '★', '☆', '♡', '♥', '-']) {
    cleaned = cleaned.replaceAll(char, ' ');
  }

  const specialCharPattern = options?.keepApostrophes
    ? /[^\p{L}\p{N}\s']/gu
    : /[^\p{L}\p{N}\s]/gu;

  return cleaned
    .replace(/&/g, 'and')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(specialCharPattern, '') // Remove remaining special chars
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
