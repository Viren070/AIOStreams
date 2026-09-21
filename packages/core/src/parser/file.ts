import { PARSE_REGEX } from './regex.js';
import { ParsedFile } from '../db/schemas.js';
import { parseTorrentTitleCached } from './title.js';
import { RESOLUTIONS } from '../utils/constants.js';
import { mapLanguageCode, convertLangCodeToName } from '../utils/languages.js';

/** The pattern tables are module constants, so their entries are built once. */
const patternEntries = new WeakMap<
  Record<string, RegExp>,
  [string, RegExp][]
>();

function entriesOf(patterns: Record<string, RegExp>): [string, RegExp][] {
  let entries = patternEntries.get(patterns);
  if (!entries) {
    entries = Object.entries(patterns);
    patternEntries.set(patterns, entries);
  }
  return entries;
}

export function matchPattern(
  filename: string,
  patterns: Record<string, RegExp>
): string | undefined {
  return entriesOf(patterns).find(([_, pattern]) =>
    pattern.test(filename)
  )?.[0];
}

function normaliseResolution(
  resolution: string | undefined
): string | undefined {
  if (!resolution) {
    return undefined;
  }

  const lower = resolution.toLowerCase();

  if (lower === '4k') {
    return '2160p';
  }

  // return known resolutions as-is
  if ((RESOLUTIONS as readonly string[]).includes(lower)) {
    return lower as (typeof RESOLUTIONS)[number];
  }

  // round numeric resolutions to the closest known resolutions
  const pMatch = lower.match(/^(\d+)p$/);
  if (pMatch) {
    const num = parseInt(pMatch[1], 10);
    const numericResolutions = (RESOLUTIONS as readonly string[])
      .filter((r) => r !== 'Unknown')
      .map((r) => [r, parseInt(r, 10)] as [string, number]);

    const closest = numericResolutions.reduce((prev, curr) =>
      Math.abs(curr[1] - num) < Math.abs(prev[1] - num) ? curr : prev
    );
    return closest[0];
  }

  return undefined;
}

export function matchMultiplePatterns(
  filename: string,
  patterns: Record<string, RegExp>
): string[] {
  return entriesOf(patterns)
    .filter(([_, pattern]) => pattern.test(filename))
    .map(([tag]) => tag);
}

/** Within a request nearly every release parses to the same title. */
const titleRegexes = new Map<string, RegExp>();
const TITLE_REGEX_MAX = 2000;

function titleRegex(parsedTitle: string): RegExp {
  let regex = titleRegexes.get(parsedTitle);
  if (!regex) {
    const escaped = parsedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped.replace(/ /g, '[._ ]'), 'i');
    if (titleRegexes.size >= TITLE_REGEX_MAX) {
      titleRegexes.delete(titleRegexes.keys().next().value!);
    }
    titleRegexes.set(parsedTitle, regex);
  }
  return regex;
}

class FileParser {
  static parse(filename: string): ParsedFile {
    const parsed = parseTorrentTitleCached(filename);
    const parsedTitle = parsed.title;
    // prevent the title from being parsed for info
    if (parsedTitle && parsedTitle.length > 4) {
      filename = filename.replace(titleRegex(parsedTitle), '').trim();
      filename = filename.replace(/\s+/g, '.').replace(/^\.+|\.+$/g, '');
    }
    const resolution =
      normaliseResolution(parsed.resolution) ||
      matchPattern(filename, PARSE_REGEX.resolutions);
    const quality = matchPattern(filename, PARSE_REGEX.qualities);
    const encode = matchPattern(filename, PARSE_REGEX.encodes);
    const audioChannels = matchMultiplePatterns(
      filename,
      PARSE_REGEX.audioChannels
    );
    const visualTags = matchMultiplePatterns(filename, PARSE_REGEX.visualTags);
    const audioTags = matchMultiplePatterns(filename, PARSE_REGEX.audioTags);
    const mapParsedLanguageToKnown = (lang: string): string | undefined => {
      switch (lang.toLowerCase()) {
        case 'multi audio':
          return 'Multi';
        case 'dual audio':
          return 'Dual Audio';
        case 'multi subs':
          return undefined;
        default:
          return convertLangCodeToName(mapLanguageCode(lang));
      }
    };

    let filenameForLangParsing = filename;
    if (parsed.group?.toLowerCase() === 'ind') {
      filenameForLangParsing = filenameForLangParsing.replace(/ind/i, '');
    }
    const languages = [
      ...new Set([
        ...matchMultiplePatterns(filenameForLangParsing, PARSE_REGEX.languages),
        ...(parsed.languages || [])
          .map(mapParsedLanguageToKnown)
          .filter((lang): lang is string => !!lang),
      ]),
    ];

    const releaseGroup = parsed.group;
    const title = parsedTitle;
    const year = parsed.year ? parsed.year.toString() : undefined;
    const country = parsed.country;
    const episodeTitle = parsed.episodeTitle;

    return {
      resolution,
      quality,
      languages,
      subtitles: [],
      encode,
      audioChannels,
      audioTags,
      visualTags,
      releaseGroup,
      title,
      year,
      country,
      episodeTitle,
      subbed: parsed.subbed ?? false,
      dubbed: parsed.dubbed ?? false,
      editions: parsed.editions,
      regraded: parsed.regraded ?? false,
      repack: parsed.repack ?? false,
      proper: parsed.proper ?? false,
      uncensored: parsed.uncensored ?? false,
      unrated: parsed.unrated ?? false,
      upscaled: parsed.upscaled ?? false,
      network: parsed.network,
      site: parsed.site,
      container: parsed.container,
      extension: parsed.extension,
      seasons: parsed.seasons,
      volumes: parsed.volumes,
      episodes: parsed.episodes,
      date: parsed.date,
      seasonPack: !!(parsed.seasons?.length && !parsed.episodes?.length),
    };
  }
}

export default FileParser;
