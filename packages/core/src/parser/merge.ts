import { ParsedFile } from '../db/schemas.js';

/**
 * Merges two arrays, deduplicating the result.
 */
export function arrayMerge<T>(arr1: T[] | undefined, arr2: T[] | undefined): T[] {
  return Array.from(new Set([...(arr1 ?? []), ...(arr2 ?? [])]));
}

/**
 * Merges two ParsedFile objects (typically from folder and file parsing),
 * combining arrays and falling back between scalar fields.
 * The `overrides` parameter allows callers to override specific fields
 * (e.g. resolution, releaseGroup, languages) after the merge.
 */
export function mergeParsedFiles(
  fileParsed: ParsedFile | undefined,
  folderParsed: ParsedFile | undefined,
  overrides?: Partial<ParsedFile>
): ParsedFile | undefined {
  if (!fileParsed && !folderParsed) return undefined;

  function arrayFallback<T>(...arrs: (T[] | undefined)[]): T[] | undefined {
    for (const arr of arrs) {
      if (arr && arr.length > 0) {
        return arr;
      }
    }
  }

  let seasonPack = folderParsed?.seasonPack || fileParsed?.seasonPack;
  let episodes = arrayFallback(fileParsed?.episodes, folderParsed?.episodes);
  let seasons = arrayFallback(fileParsed?.seasons, folderParsed?.seasons);

  return {
    title: folderParsed?.title || fileParsed?.title,
    year: fileParsed?.year || folderParsed?.year,
    folderSeasons:
      seasons !== folderParsed?.seasons ? folderParsed?.seasons : undefined,
    folderEpisodes:
      episodes !== folderParsed?.episodes ? folderParsed?.episodes : undefined,
    seasons,
    episodes,
    resolution: fileParsed?.resolution || folderParsed?.resolution,
    quality: fileParsed?.quality || folderParsed?.quality,
    encode: fileParsed?.encode || folderParsed?.encode,
    releaseGroup: fileParsed?.releaseGroup || folderParsed?.releaseGroup,
    edition: fileParsed?.edition || folderParsed?.edition,
    remastered: fileParsed?.remastered || folderParsed?.remastered,
    repack: fileParsed?.repack || folderParsed?.repack,
    uncensored: fileParsed?.uncensored || folderParsed?.uncensored,
    unrated: fileParsed?.unrated || folderParsed?.unrated,
    upscaled: fileParsed?.upscaled || folderParsed?.upscaled,
    network: fileParsed?.network || folderParsed?.network,
    container: fileParsed?.container || folderParsed?.container,
    extension: fileParsed?.extension || folderParsed?.extension,
    visualTags: arrayMerge(folderParsed?.visualTags, fileParsed?.visualTags),
    audioTags: arrayMerge(folderParsed?.audioTags, fileParsed?.audioTags),
    audioChannels: arrayMerge(
      folderParsed?.audioChannels,
      fileParsed?.audioChannels
    ),
    languages: arrayMerge(folderParsed?.languages, fileParsed?.languages),
    seasonPack,
    ...overrides,
  };
}
