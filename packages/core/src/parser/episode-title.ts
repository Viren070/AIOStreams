import { normaliseTitle } from './utils.js';
import type { MetadataTitle } from '../metadata/utils.js';

/**
 * Some releases put a series subtitle after SxxExx, where the parser treats
 * it as part of the episode name. Only remove a prefix corroborated by a
 * known series title (or a complete colon/dash-delimited title component).
 * Keep the cached parser result intact and leave unknown prefixes alone.
 */
export function withoutSeriesSubtitle(
  episodeTitle: string,
  parsedShowTitle: string | undefined,
  showTitles: MetadataTitle[]
): string {
  const show = normaliseTitle(parsedShowTitle ?? '');
  if (!show) return episodeTitle;

  const known = new Set<string>();
  for (const { title } of showTitles) {
    known.add(normaliseTitle(title));
    for (const delimiter of title.matchAll(/[:：]|\s+[-–—]\s+/gu)) {
      known.add(normaliseTitle(title.slice(0, delimiter.index)));
    }
  }

  let result = episodeTitle;
  for (const separator of episodeTitle.matchAll(/[\s._:–—-]+/gu)) {
    const prefix = normaliseTitle(episodeTitle.slice(0, separator.index));
    const remainder = episodeTitle.slice(separator.index + separator[0].length);
    if (prefix && normaliseTitle(remainder) && known.has(show + prefix)) {
      result = remainder;
    }
  }
  return result;
}
