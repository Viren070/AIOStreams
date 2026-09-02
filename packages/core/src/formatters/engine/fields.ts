/**
 * The `<section>.<property>` names templates may reference.
 *
 * A field present in `convertStreamToParseValue` but missing here degrades
 * every template referencing it to literal text.
 */

export const FIELD_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  config: ['addonName'],
  stream: [
    'filename',
    'folderName',
    'size',
    'bitrate',
    'folderSize',
    'library',
    'quality',
    'resolution',
    'subbed',
    'dubbed',
    'languages',
    'mediaInfoQuality',
    'uLanguages',
    'subtitles',
    'uSubtitles',
    'languageEmojis',
    'uLanguageEmojis',
    'subtitleEmojis',
    'uSubtitleEmojis',
    'languageCodes',
    'uLanguageCodes',
    'subtitleCodes',
    'uSubtitleCodes',
    'smallLanguageCodes',
    'uSmallLanguageCodes',
    'smallSubtitleCodes',
    'uSmallSubtitleCodes',
    'wedontknowwhatakilometeris',
    'uWedontknowwhatakilometeris',
    'visualTags',
    'audioTags',
    'releaseGroup',
    'regexMatched',
    'rankedRegexMatched',
    'regexScore',
    'nRegexScore',
    'encode',
    'audioChannels',
    'edition',
    'editions',
    'remastered',
    'regraded',
    'repack',
    'proper',
    'uncensored',
    'unrated',
    'upscaled',
    'hasChapters',
    'network',
    'container',
    'extension',
    'indexer',
    'year',
    'title',
    'country',
    'episodeTitle',
    'date',
    'folderSeasons',
    'formattedFolderSeasons',
    'seasons',
    'season',
    'formattedSeasons',
    'episodes',
    'episode',
    'formattedEpisodes',
    'folderEpisodes',
    'formattedFolderEpisodes',
    'seasonEpisode',
    'seasonPack',
    'seeders',
    'private',
    'freeleech',
    'age',
    'ageHours',
    'duration',
    'infoHash',
    'type',
    'message',
    'proxied',
    'seadex',
    'seadexBest',
    'seScore',
    'nSeScore',
    'seMatched',
    'rseMatched',
    'preloading',
    'idMatched',
  ],
  metadata: [
    'queryType',
    'type',
    'isAnime',
    'title',
    'titles',
    'year',
    'yearEnd',
    'runtime',
    'episodeRuntime',
    'genres',
    'originalLanguage',
    'country',
    'season',
    'episode',
    'absoluteEpisode',
    'relativeAbsoluteEpisode',
    'episodeTitle',
    'episodeTitles',
    'latestSeason',
    'daysSinceRelease',
    'daysSinceFirstAired',
    'daysSinceLastAired',
    'hasNextEpisode',
    'daysUntilNextEpisode',
    'anilistId',
    'malId',
    'hasSeaDex',
  ],
  service: ['id', 'shortName', 'name', 'cached'],
  addon: ['name', 'presetId', 'manifestUrl'],
  debug: ['json', 'jsonf'],
} as const;

/** Lower-cased name to its canonical spelling, so field names are case-insensitive. */
const CANONICAL_FIELDS: ReadonlyMap<string, [string, string]> = new Map(
  Object.entries(FIELD_REGISTRY).flatMap(([section, properties]) =>
    properties.map(
      (property) =>
        [`${section}.${property}`.toLowerCase(), [section, property]] as [
          string,
          [string, string],
        ]
    )
  )
);

/** Returns the canonical `[section, property]`, or undefined if unknown. */
export function canonicaliseField(
  section: string,
  property: string
): [string, string] | undefined {
  return CANONICAL_FIELDS.get(`${section}.${property}`.toLowerCase());
}

/** Lower-cased property to every `section.property` declaring it. */
const PROPERTY_INDEX: ReadonlyMap<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [section, properties] of Object.entries(FIELD_REGISTRY)) {
    for (const property of properties) {
      const key = property.toLowerCase();
      const existing = index.get(key);
      if (existing) existing.push(`${section}.${property}`);
      else index.set(key, [`${section}.${property}`]);
    }
  }
  return index;
})();

/**
 * Levenshtein distance, but it stops as soon as it exceeds `max`. Bounded so a
 * suggestion can never be a wild guess.
 */
function distanceAtMost(a: string, b: string, max: number): number | undefined {
  if (Math.abs(a.length - b.length) > max) return undefined;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      best = Math.min(best, current[j]);
    }
    if (best > max) return undefined;
    previous = current;
  }
  const distance = previous[b.length];
  return distance <= max ? distance : undefined;
}

/** Tight enough that a suggestion is a near-miss rather than a guess. */
function budget(word: string): number {
  return Math.min(2, Math.floor(word.length / 3));
}

/** Closest single entry in `candidates`, or undefined when none is near enough. */
export function nearestName(
  word: string,
  candidates: readonly string[]
): string | undefined {
  return nearest(word, candidates)[0];
}

/** Closest entries in `candidates`, or [] when nothing is near enough. */
function nearest(word: string, candidates: readonly string[]): string[] {
  const max = budget(word);
  if (max < 1) return [];
  const lower = word.toLowerCase();
  let best = max + 1;
  let matches: string[] = [];
  for (const candidate of candidates) {
    const distance = distanceAtMost(lower, candidate.toLowerCase(), max);
    if (distance === undefined || distance > best) continue;
    if (distance < best) {
      best = distance;
      matches = [];
    }
    matches.push(candidate);
  }
  return matches;
}

/**
 * Best-guess corrections for an unknown field, as canonical `section.property`
 * strings. Diagnostics only — the parser never consults this.
 */
export function suggestField(section: string, property: string): string[] {
  // the property exists, just under another section: exact, not a guess
  const elsewhere = PROPERTY_INDEX.get(property.toLowerCase());
  if (elsewhere) return [...elsewhere];

  const sections = Object.keys(FIELD_REGISTRY);
  const canonicalSection = sections.find(
    (name) => name.toLowerCase() === section.toLowerCase()
  );

  // misspelt property within a real section
  if (canonicalSection) {
    const properties = FIELD_REGISTRY[canonicalSection];
    return nearest(property, properties).map(
      (name) => `${canonicalSection}.${name}`
    );
  }

  // misspelt section, keeping only those that actually declare the property
  return nearest(section, sections)
    .map((name) => canonicaliseField(name, property))
    .filter((field): field is [string, string] => field !== undefined)
    .map(([s, p]) => `${s}.${p}`);
}
