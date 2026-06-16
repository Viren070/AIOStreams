import type { AnimeEntry } from '../anime-database/index.js';

const SEASON_WORD_PATTERNS = [
  'season',
  'staffel',
  'saison',
  'sezon',
  'temporada',
];

const ROMAN_NUMERALS: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};

function cleanSearchTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export interface AmbiguousAnimeTitleMetadata {
  primaryTitle?: string;
  titles?: string[];
  externalTitle?: string;
  externalTitles?: string[];
  logicalSeason?: number;
  seasonYear?: number;
}

export function extractLogicalSeasonFromTitles(
  titles: Array<string | undefined | null>
): number | undefined {
  for (const rawTitle of titles) {
    if (!rawTitle) continue;
    const title = rawTitle.toString();

    const ordinalMatch = title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
    if (ordinalMatch) return Number(ordinalMatch[1]);

    for (const seasonWord of SEASON_WORD_PATTERNS) {
      const match = title.match(
        new RegExp(`\\b${seasonWord}\\s+(\\d+)\\b`, 'i')
      );
      if (match) return Number(match[1]);
    }

    const romanMatch = title.match(/\b([IVX]+)\s+season\b/i);
    if (romanMatch) {
      return ROMAN_NUMERALS[romanMatch[1].toUpperCase()];
    }
  }
  return undefined;
}

export function getAnimeEntryStartEpisode(
  animeEntry?: AnimeEntry | null
): number | undefined {
  const raw =
    animeEntry?.imdb?.fromEpisode ??
    animeEntry?.tvdb?.fromEpisode ??
    animeEntry?.tmdb?.fromEpisode;

  if (raw === undefined || raw === null) return undefined;

  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function calculateLogicalEpisode(
  externalEpisode?: number,
  animeEntry?: AnimeEntry | null
): number | undefined {
  if (!externalEpisode) return externalEpisode;

  const fromEpisode = getAnimeEntryStartEpisode(animeEntry);
  if (!fromEpisode || fromEpisode <= 1 || externalEpisode < fromEpisode) {
    return externalEpisode;
  }

  return externalEpisode - fromEpisode + 1;
}

export function dedupeCleanTitles(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const title = cleanSearchTitle(String(value ?? ''));
    if (!title) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(title);
  }

  return result;
}

export function buildAnimeTitles(
  animeEntry: AnimeEntry | null | undefined,
  fallbackTitle: string | undefined,
  logicalSeason?: number,
  seasonYear?: number | null
): string[] {
  const titles = dedupeCleanTitles([
    animeEntry?.title,
    ...(animeEntry?.synonyms ?? []),
    fallbackTitle,
  ]);

  if (!logicalSeason) return titles;

  const seasonRegex = new RegExp(
    `\\b(${logicalSeason}(?:st|nd|rd|th)?\\s+season|season\\s+${logicalSeason}|s${logicalSeason}\\b|cour\\s+${logicalSeason}|part\\s+${logicalSeason}|staffel\\s+${logicalSeason}|saison\\s+${logicalSeason}|sezon\\s+${logicalSeason}|temporada\\s+${logicalSeason})`,
    'i'
  );
  const explicitTitles = titles.filter((title) => seasonRegex.test(title));
  const yearTitles = seasonYear
    ? titles.filter(
        (title) =>
          title.includes(`(${seasonYear})`) || title.includes(` ${seasonYear}`)
      )
    : [];

  const filtered = dedupeCleanTitles([
    animeEntry?.title,
    ...explicitTitles,
    ...yearTitles,
    fallbackTitle,
  ]);

  return filtered.length > 0 ? filtered : titles;
}

export function stripAnimeSeasonQualifier(
  title: string,
  logicalSeason?: number,
  seasonYear?: number
): string {
  let value = cleanSearchTitle(title);
  if (!value) return '';

  if (seasonYear) {
    value = value
      .replace(new RegExp(`\\s*\\(${seasonYear}\\)\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s+${seasonYear}\\s*$`, 'i'), '');
  }

  if (logicalSeason) {
    const season = logicalSeason.toString();
    const paddedSeason = season.padStart(2, '0');
    const patterns = [
      `\\b${season}(?:st|nd|rd|th)\\s+season\\b`,
      `\\bseason\\s+${season}\\b`,
      `\\bs${season}\\b`,
      `\\bs${paddedSeason}\\b`,
      `\\bcour\\s+${season}\\b`,
      `\\bpart\\s+${season}\\b`,
      `\\bstaffel\\s+${season}\\b`,
      `\\bsaison\\s+${season}\\b`,
      `\\bsezon\\s+${season}\\b`,
      `\\btemporada\\s+${season}\\b`,
    ];

    for (const pattern of patterns) {
      value = value.replace(new RegExp(pattern, 'gi'), '');
    }
  }

  return cleanSearchTitle(
    value.replace(/\s*[:|/\\._-]+\s*$/g, '').replace(/\s{2,}/g, ' ')
  );
}

export function isLatinSearchTitle(title: string): boolean {
  const folded = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /[a-z]/i.test(folded);
}

export function selectAmbiguousAnimeBaseTitles(
  metadata: AmbiguousAnimeTitleMetadata,
  maxTitles = 2
): string[] {
  return dedupeCleanTitles([
    metadata.externalTitle,
    ...(metadata.externalTitles ?? []),
    metadata.primaryTitle,
    ...(metadata.titles ?? []),
  ])
    .map((title) =>
      stripAnimeSeasonQualifier(
        title,
        metadata.logicalSeason,
        metadata.seasonYear
      )
    )
    .filter(isLatinSearchTitle)
    .slice(0, maxTitles);
}

export function selectAmbiguousAnimeEntryTitles(
  metadata: AmbiguousAnimeTitleMetadata,
  maxTitles = 2
): string[] {
  return dedupeCleanTitles([metadata.primaryTitle, ...(metadata.titles ?? [])])
    .filter(isLatinSearchTitle)
    .slice(0, maxTitles);
}

export function buildAmbiguousAnimeQueryWaves(
  metadata: AmbiguousAnimeTitleMetadata & {
    logicalEpisode?: number;
  },
  options: { maxBaseTitles?: number; maxEntryTitles?: number } = {}
): string[][] {
  if (!metadata.logicalSeason || !metadata.logicalEpisode) {
    return [];
  }

  const logicalSeason = Number(metadata.logicalSeason);
  const logicalEpisode = Number(metadata.logicalEpisode);
  if (!Number.isFinite(logicalSeason) || !Number.isFinite(logicalEpisode)) {
    return [];
  }

  const season = logicalSeason.toString().padStart(2, '0');
  const episode = logicalEpisode.toString().padStart(2, '0');
  const baseTitles = selectAmbiguousAnimeBaseTitles(
    metadata,
    options.maxBaseTitles ?? 2
  );
  const entryTitles = selectAmbiguousAnimeEntryTitles(
    metadata,
    options.maxEntryTitles ?? 2
  );

  const wave1 = dedupeCleanTitles(
    baseTitles.flatMap((title) => [
      `${title} S${season}E${episode}`,
      `${title} S${season}`,
    ])
  );
  const wave2 = dedupeCleanTitles(
    entryTitles.flatMap((title) => [
      `${title} ${episode}`,
      `${title} E${episode}`,
    ])
  );

  return [wave1, wave2].filter((wave) => wave.length > 0);
}
