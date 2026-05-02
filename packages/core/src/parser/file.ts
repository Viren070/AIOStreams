import { PARSE_REGEX } from './regex.js';
import { ParsedFile } from '../db/schemas.js';
import { Parser, handlers } from '@viren070/parse-torrent-title';
import { RESOLUTIONS } from '../utils/constants.js';
import { mapLanguageCode, convertLangCodeToName } from '../utils/languages.js';

function matchPattern(
  filename: string,
  patterns: Record<string, RegExp>
): string | undefined {
  return Object.entries(patterns).find(([_, pattern]) =>
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

function matchMultiplePatterns(
  filename: string,
  patterns: Record<string, RegExp>
): string[] {
  return Object.entries(patterns)
    .filter(([_, pattern]) => pattern.test(filename))
    .map(([tag]) => tag);
}

class FileParser {
  private static parser = new Parser().addHandlers(
    handlers.filter((handler) => handler.field !== 'country')
  );

  static parse(filename: string): ParsedFile {
    const parsed = this.parser.parse(filename);
    if (
      ['vinland', 'furiosaamadmax', 'horizonanamerican'].includes(
        (parsed.title || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^\p{L}\p{N}+]/gu, '')
          .toLowerCase()
      ) &&
      parsed.complete
    ) {
      parsed.title += ' Saga';
    }
    // prevent the title from being parsed for info
    if (parsed.title && parsed.title.length > 4) {
      const escapedTitle = parsed.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const titleRegex = new RegExp(escapedTitle.replace(/ /g, '[._ ]'), 'i');
      filename = filename.replace(titleRegex, '').trim();
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

    const releaseGroup =
      filename.match(PARSE_REGEX.releaseGroup)?.[1] ?? parsed.group;
    const title = parsed.title;
    const year = parsed.year ? parsed.year.toString() : undefined;

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
      subbed: parsed.subbed ?? false,
      dubbed: parsed.dubbed ?? false,
      editions: parsed.editions,
      regraded: parsed.regraded ?? false,
      repack: parsed.repack ?? false,
      uncensored: parsed.uncensored ?? false,
      unrated: parsed.unrated ?? false,
      upscaled: parsed.upscaled ?? false,
      network: parsed.network,
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
