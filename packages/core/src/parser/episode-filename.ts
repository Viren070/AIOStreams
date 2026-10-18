import type { ParsedFile } from '../db/schemas.js';
import FileParser from './file.js';
import { normaliseTitle, preprocessTitle } from './utils.js';

/** Recover episode labels before title/identity filtering, using release evidence only. */
export function reconcileEpisodeFilename(
  parsed: ParsedFile,
  filename: string | undefined,
  folderName: string | undefined,
  titles: string[]
): ParsedFile {
  if (
    !filename ||
    !titles.length ||
    !/\.(?:mkv|mp4|avi|m4v|ts|m2ts|webm)$/i.test(filename)
  )
    return parsed;
  const name = filename
    .replace(/\.(?:mkv|mp4|avi|m4v|ts|m2ts|webm)$/i, '')
    .replace(/^(?:\s*\[[^\]]+\])+\s*/, '')
    .replace(/[._]/g, ' ')
    .trim();
  const known = new Set(titles.map(normaliseTitle));
  const folder = folderName ? FileParser.parse(folderName) : undefined;
  const folderTitle = folder?.title
    ? preprocessTitle(folder.title, [folderName], titles)
    : undefined;
  const matchingFolder =
    !!folderTitle && known.has(normaliseTitle(folderTitle));

  // Do not interpret ranges, batches, dates or bare numbers as a single episode.
  const labelled = name.match(
    /^(.*?)\b(?:session|episode|ep)\s*#?\s*[-:]?\s*(\d{1,3})(?:\s*[-:]\s*|\s+)(\p{L}.*)$/iu
  );
  const bare = name.match(
    /^(?:S(\d{1,2})\s*E(\d{1,3})|(\d{1,3}))(?:\s*[-:]\s*|\s+)(\p{L}.*)$/iu
  );
  if (!labelled && !bare) return parsed;
  const prefix = labelled?.[1].replace(/[\s-]+$/, '').trim();
  // A different named show must never inherit the requested identity from a folder.
  if (prefix && !known.has(normaliseTitle(prefix))) return parsed;
  if (!prefix && !matchingFolder) return parsed;

  const title = prefix || folderTitle!;
  const episode = Number(labelled?.[2] ?? bare?.[2] ?? bare?.[3]);
  if (!Number.isSafeInteger(episode) || episode < 1) return parsed;
  const season = bare?.[1] ? Number(bare[1]) : undefined;
  if (season === 0) return parsed;
  const file = FileParser.parse(filename);
  const agrees = (values: number[] | undefined, value: number) =>
    !values?.length || (values.length === 1 && values[0] === value);
  const inherited = (
    values: number[] | undefined,
    parent: number[] | undefined
  ) =>
    !!values?.length &&
    !!parent?.length &&
    values.length === parent.length &&
    values.every((value, i) => value === parent[i]);
  // Only discard conflicting merged coordinates when they demonstrably came
  // from the parent pack. Never erase a batch or conflict in the actual file.
  if (!agrees(file.episodes, episode)) return parsed;
  if (
    !agrees(parsed.episodes, episode) &&
    (file.episodes?.length || !inherited(parsed.episodes, folder?.episodes))
  )
    return parsed;
  if (
    season !== undefined &&
    (!agrees(file.seasons, season) ||
      (!agrees(parsed.seasons, season) &&
        (file.seasons?.length || !inherited(parsed.seasons, folder?.seasons))))
  )
    return parsed;

  const episodeName = labelled?.[3] ?? bare![4];
  const recovered = FileParser.parse(
    `${title} S${season ?? 1}E${episode} ${episodeName}`
  );
  if (!recovered.episodeTitle) return parsed;
  const seasons =
    season !== undefined
      ? [season]
      : parsed.seasons?.length
        ? parsed.seasons
        : matchingFolder && folder!.seasons?.length === 1
          ? folder!.seasons
          : [];
  return {
    ...parsed,
    title,
    episodeTitle: recovered.episodeTitle,
    episodes: [episode],
    seasons,
    // Explicit conflicting identity tags must survive for the normal filters.
    year: parsed.year ?? (matchingFolder ? folder!.year : undefined),
    country: parsed.country ?? (matchingFolder ? folder!.country : undefined),
  };
}
