import { PARSE_REGEX } from './regex.js';
import { ParsedFile } from '../db/schemas.js';
import ptt from './ptt.js';

function matchPattern(
  filename: string,
  patterns: Record<string, RegExp>
): string | undefined {
  return Object.entries(patterns).find(([_, pattern]) =>
    pattern.test(filename)
  )?.[0];
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
  static parse(filename: string): ParsedFile {
    const parsed = ptt.parse(filename);
    if (
      ['vinland'].includes(parsed.title?.toLowerCase() || '') &&
      parsed.complete
    ) {
      parsed.title += ' Saga';
    }
    // prevent the title from being parsed for info
    if (parsed.title && parsed.title.length > 4) {
      filename = filename.replace(parsed.title, '').trim();
      filename = filename.replace(/\s+/g, '.').replace(/^\.+|\.+$/g, '');
    }
    const resolution = matchPattern(filename, PARSE_REGEX.resolutions);
    const quality = matchPattern(filename, PARSE_REGEX.qualities);
    const encode = matchPattern(filename, PARSE_REGEX.encodes);
    const audioChannels = matchMultiplePatterns(
      filename,
      PARSE_REGEX.audioChannels
    );
    const visualTags = matchMultiplePatterns(filename, PARSE_REGEX.visualTags);
    const audioTags = matchMultiplePatterns(filename, PARSE_REGEX.audioTags);
    const languages = matchMultiplePatterns(filename, PARSE_REGEX.languages);

    const getPaddedNumber = (number: number, length: number) =>
      number.toString().padStart(length, '0');

    const releaseGroup = parsed.group;
    const title = parsed.title;
    const year = parsed.year ? parsed.year.toString() : undefined;
    const season = parsed.season;
    const seasons = parsed.seasons;
    const episode = parsed.episode;
    const formattedSeasonString = seasons?.length
      ? seasons.length === 1
        ? `S${getPaddedNumber(seasons[0], 2)}`
        : `S${getPaddedNumber(seasons[0], 2)}-${getPaddedNumber(
            seasons[seasons.length - 1],
            2
          )}`
      : season
        ? `S${getPaddedNumber(season, 2)}`
        : undefined;
    const formattedEpisodeString = episode
      ? `E${getPaddedNumber(episode, 2)}`
      : undefined;

    const seasonEpisode = [
      formattedSeasonString,
      formattedEpisodeString,
    ].filter((v) => v !== undefined);

    return {
      resolution,
      quality,
      languages,
      encode,
      audioChannels,
      audioTags,
      visualTags,
      releaseGroup,
      title,
      year,
      season,
      seasons,
      episode,
      seasonEpisode,
    };
  }
}

export default FileParser;
