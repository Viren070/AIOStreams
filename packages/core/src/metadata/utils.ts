export interface MetadataTitle {
  title: string;
  language?: string; // ISO 639-1 language code, normalised from provider-specific formats
  trusted?: boolean;
}

/**
 * Deduplicates a list of MetadataTitle entries by title string (case-insensitive).
 * Insertion order of first occurrence is preserved.
 */
export function deduplicateTitles(
  titles: MetadataTitle[],
  originalLanguage?: string
): MetadataTitle[] {
  const titleLangs = new Map<string, Set<string>>();
  const titleTrustedLangs = new Map<string, Set<string>>();
  const titleHasUntagged = new Set<string>();
  const titleKeys: string[] = [];
  const titleFirstOccurrence = new Map<string, MetadataTitle>();

  for (const t of titles) {
    const key = t.title.toLowerCase();
    if (!titleLangs.has(key)) {
      titleLangs.set(key, new Set());
      titleTrustedLangs.set(key, new Set());
      titleKeys.push(key);
      titleFirstOccurrence.set(key, t);
    }
    if (t.language) {
      titleLangs.get(key)!.add(t.language);
      if (t.trusted) {
        titleTrustedLangs.get(key)!.add(t.language);
      }
    } else {
      titleHasUntagged.add(key);
    }
  }

  return titleKeys.map((key) => {
    const first = titleFirstOccurrence.get(key)!;
    const langs = titleLangs.get(key)!;
    const trustedLangs = titleTrustedLangs.get(key)!;

    let language: string | undefined;
    if (trustedLangs.size === 1) {
      language = [...trustedLangs][0];
    } else if (trustedLangs.size === 0) {
      const unambiguous = langs.size === 1 && !titleHasUntagged.has(key);
      language = unambiguous ? [...langs][0] : undefined;
    }
    // Only rescues an ambiguous tag, so a trusted (TMDB) tag always wins.
    if (
      language === undefined &&
      originalLanguage &&
      langs.has(originalLanguage)
    ) {
      language = originalLanguage;
    }
    return {
      title: first.title,
      language,
    };
  });
}

/** Another title sharing this title's name (reboot or country variant). */
export interface TitleConflict {
  title: string;
  year?: number;
  country?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface Metadata {
  title: string;
  titles?: MetadataTitle[];
  year?: number;
  yearEnd?: number;
  originalLanguage?: string;
  country?: string;
  /** Same-name series that results could belong to instead of this one. */
  titleConflicts?: TitleConflict[];
  /** Known names of the requested episode, across sources and languages. */
  episodeTitles?: MetadataTitle[];
  /**
   * Years a release may legitimately be tagged with: first aired, plus the
   * requested season's and episode's years. Series only, empty if unresolved.
   */
  releaseYears?: number[];
  releaseDate?: string;
  runtime?: number; // Runtime in minutes
  seasons?: {
    season_number: number;
    episode_count: number;
  }[];
  tmdbId?: number | null;
  tvdbId?: number | null;
  genres?: string[]; // Genre names (e.g., ["Action", "Drama"])
  nextAirDate?: string;
  firstAiredDate?: string;
  lastAiredDate?: string;
  /** Requested series/season is date-based (releases named by air date, e.g. talk shows). */
  isDateBased?: boolean;
  /** Candidate local air dates ('YYYY-MM-DD') for the requested episode. Usually length 1. */
  episodeAirDates?: string[];
  /** episodeAirDates[0], the highest-priority date. */
  episodeAirDate?: string;
  /** Season number the requested season resolved to (differs from the request under ordinal fallback). */
  resolvedSeasonNumber?: number;
  /** First episode number of the resolved season (>1 means continuous absolute numbering). */
  resolvedSeasonFirstEpisode?: number;
  /** Season number under the other (year vs. ordinal) convention, when it differs. */
  alternateSeasonNumber?: number;
  /** Scene-mapping search titles for this series, best (non-identity) first. */
  sceneTitles?: string[];
}
