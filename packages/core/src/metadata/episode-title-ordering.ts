import type { MetadataTitle } from './utils.js';

export interface EpisodeTitleSource {
  airDate?: string;
  titles: MetadataTitle[];
}

const DATE_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000;

/** Fold case and punctuation for exact episode-title identity comparisons. */
function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Reject empty names and numbered placeholders as episode identity evidence. */
function isUsefulTitle(title: string): boolean {
  const key = titleKey(title);
  return key.length > 0 && !/^(?:episode|ep|chapter)\d+$/.test(key);
}

/** Collect meaningful names for provider agreement and conflict checks. */
function usefulTitles(source: EpisodeTitleSource): string[] {
  return source.titles
    .filter(({ title }) => isUsefulTitle(title))
    .map(({ title }) => titleKey(title));
}

/**
 * IMDb IDs do not specify a separate metadata addon's episode ordering.
 * Withhold episode-title evidence only for dated sources that disagree on
 * usable names as well as the reference date. Never union rival orders.
 */
export function selectEpisodeTitles(
  requestProvider: string,
  referenceAirDate: string | null | undefined,
  sources: (EpisodeTitleSource | undefined)[],
  cinemetaEpisode?: EpisodeTitleSource
): { titles: MetadataTitle[]; orderingConflict: boolean } {
  const reference = Date.parse(referenceAirDate ?? '');
  const dated = [...sources, cinemetaEpisode].flatMap((source) => {
    if (!source) return [];
    const date = Date.parse(source.airDate ?? '');
    const names = usefulTitles(source);
    return Number.isFinite(date) && names.length ? [{ date, names }] : [];
  });
  const orderingConflict =
    requestProvider === 'imdbId' &&
    dated.some((left, index) =>
      dated.slice(index + 1).some((right) => {
        // Preserve the original tolerance relative to the reference, rather
        // than narrowing it by comparing the minimum and maximum source dates.
        const outsideReference =
          !Number.isFinite(reference) ||
          Math.abs(left.date - reference) > DATE_TOLERANCE_MS ||
          Math.abs(right.date - reference) > DATE_TOLERANCE_MS;
        return (
          outsideReference &&
          Math.abs(left.date - right.date) > DATE_TOLERANCE_MS &&
          !left.names.some((name) => right.names.includes(name))
        );
      })
    );
  if (orderingConflict) return { titles: [], orderingConflict: true };

  const referenceNames = new Set(
    dated
      .filter(
        ({ date }) =>
          Number.isFinite(reference) &&
          Math.abs(date - reference) <= DATE_TOLERANCE_MS
      )
      .flatMap(({ names }) => names)
  );
  const titles: MetadataTitle[] = [];
  for (const source of sources) {
    if (!source) continue;
    const date = Date.parse(source.airDate ?? '');
    const outsideReference =
      Number.isFinite(reference) &&
      Number.isFinite(date) &&
      Math.abs(reference - date) > DATE_TOLERANCE_MS;
    const corroboratedNames = new Set(
      usefulTitles(source).filter((name) => referenceNames.has(name))
    );
    // A corroborated episode record can supply translations, not just the
    // literal name shared with the reference. Recover the anchor's language
    // from any source carrying that exact name (TMDB may leave it untagged).
    const anchorLanguages = new Set(
      [...sources, cinemetaEpisode].flatMap((record) =>
        (record?.titles ?? []).flatMap((title) =>
          title.language && corroboratedNames.has(titleKey(title.title))
            ? [title.language.toLowerCase()]
            : []
        )
      )
    );
    const candidates =
      outsideReference && requestProvider === 'imdbId'
        ? source.titles.filter(
            (title) =>
              corroboratedNames.has(titleKey(title.title)) ||
              // Keep explicitly tagged translations of this corroborated record.
              // Do not promote unrelated or untagged same-language aliases.
              (anchorLanguages.size > 0 &&
                !!title.language &&
                !anchorLanguages.has(title.language.toLowerCase()))
          )
        : outsideReference
          ? []
          : source.titles;
    for (const title of candidates) {
      if (!isUsefulTitle(title.title)) continue;
      const existing = titles.find(
        (candidate) =>
          candidate.title.toLowerCase() === title.title.toLowerCase()
      );
      if (!existing) {
        titles.push({ ...title });
      } else if (!existing.language && title.language) {
        // Preserve language coverage when an untagged TMDB name came first.
        existing.language = title.language;
      }
    }
  }

  return { titles, orderingConflict: false };
}
