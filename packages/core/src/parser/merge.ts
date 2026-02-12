import { ParsedFile } from '../db/schemas.js';

/**
 * Merge two arrays into a single deduplicated array, preserving the first occurrence order.
 *
 * @param arr1 - First array; treated as empty if `undefined`. Values from this array appear before `arr2` in the result.
 * @param arr2 - Second array; treated as empty if `undefined`. Later occurrences of values already present from `arr1` are omitted.
 * @returns A new array containing the unique elements from `arr1` followed by unique elements from `arr2` that were not already present.
 */
export function arrayMerge<T>(arr1: T[] | undefined, arr2: T[] | undefined): T[] {
  return Array.from(new Set([...(arr1 ?? []), ...(arr2 ?? [])]));
}

/**
 * Merge two ParsedFile records into a single ParsedFile by combining multi-valued fields and selecting fallbacks for scalar fields.
 *
 * @param fileParsed - Parsed data extracted from the file (preferred for most scalar fields).
 * @param folderParsed - Parsed data extracted from the containing folder (preferred for title and seasonPack when present).
 * @param overrides - Partial fields to apply on top of the merged result; provided properties replace merged values.
 * @returns The merged ParsedFile, or `undefined` if both inputs are `undefined`.
 */
export function mergeParsedFiles(
  fileParsed: ParsedFile | undefined,
  folderParsed: ParsedFile | undefined,
  overrides?: Partial<ParsedFile>
): ParsedFile | undefined {
  if (!fileParsed && !folderParsed) return undefined;

  /**
   * Selects the first non-empty array from the provided arguments.
   *
   * @param arrs - Arrays to check in order of preference
   * @returns The first argument that is an array with length greater than zero, or `undefined` if none match
   */
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