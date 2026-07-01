/**
 * Pure helpers for "Infuse mode" — building the `infuse://` launch URL and the
 * subtitle-proxy path, and resolving target subtitle languages. Kept free of
 * I/O and global config (callers pass `baseUrl`) so they are easily unit
 * tested. The orchestration (querying subtitle addons, rewriting streams) lives
 * in `resources.ts`; the proxy endpoint lives in the server's `app.ts`.
 */
import { normaliseLanguage, languageToCode } from '../utils/languages.js';
import type { Subtitle } from '../db/schemas.js';

export const INFUSE_DEFAULT_TOP_N = 5;
export const INFUSE_DEFAULT_CANDIDATES = 3;
export const INFUSE_DEFAULT_LANGUAGE = 'English';

/**
 * Resolve the ordered list of target subtitle languages (canonical display
 * names) from a user's `preferredSubtitles`, falling back to English when none
 * are set/recognised.
 */
export function infuseTargetLanguages(
  preferredSubtitles: readonly string[] | undefined
): string[] {
  const prefs = (preferredSubtitles ?? [])
    .map((l) => normaliseLanguage(l))
    .filter((l): l is string => !!l);
  return prefs.length > 0 ? prefs : [INFUSE_DEFAULT_LANGUAGE];
}

/**
 * From a flat list of subtitles, pick those matching the target languages in
 * target-priority order, deduped by URL, capped at `limit`. Ordered so the
 * subtitle proxy can fall back to the next candidate if an earlier one is dead.
 */
export function selectInfuseSubtitles(
  subtitles: Subtitle[],
  targets: string[],
  limit: number
): Subtitle[] {
  const out: Subtitle[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    for (const s of subtitles) {
      if (s.url && !seen.has(s.url) && normaliseLanguage(s.lang) === target) {
        seen.add(s.url);
        out.push(s);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/**
 * Build this addon's subtitle-proxy URL. The path ends in `Subtitle-<iso>.srt`
 * so Infuse recognises it as a subtitle (by extension) and labels the track by
 * language. Candidate upstream URLs are base64url(JSON)-encoded in the path; the
 * media filename rides in `?t=` purely for server-side logging.
 */
export function infuseSubProxyUrl(
  baseUrl: string,
  subUrls: string[],
  isoCode: string,
  mediaFilename?: string
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const payload = Buffer.from(JSON.stringify(subUrls), 'utf-8').toString(
    'base64url'
  );
  let url = `${base}/infuse-sub/${payload}/Subtitle-${isoCode}.srt`;
  if (mediaFilename) {
    url += `?t=${encodeURIComponent(mediaFilename.slice(0, 160))}`;
  }
  return url;
}

/** ISO 639-1 code (lowercase) for a subtitle's language, or `und` if unknown. */
export function infuseSubtitleIsoCode(sub: Subtitle | undefined): string {
  const lang = sub && normaliseLanguage(sub.lang);
  return (lang && languageToCode(lang)?.toLowerCase()) || 'und';
}

/**
 * Build the full `infuse://x-callback-url/play` launch URL for one media URL,
 * with the chosen subtitle candidates wrapped in the proxy (if any).
 */
export function buildInfusePlayUrl(
  baseUrl: string,
  mediaUrl: string,
  subs: Subtitle[],
  mediaFilename?: string
): string {
  let link = `infuse://x-callback-url/play?url=${encodeURIComponent(mediaUrl)}`;
  if (subs.length > 0) {
    const proxied = infuseSubProxyUrl(
      baseUrl,
      subs.map((s) => s.url),
      infuseSubtitleIsoCode(subs[0]),
      mediaFilename
    );
    link += `&sub=${encodeURIComponent(proxied)}`;
  }
  if (mediaFilename) link += `&filename=${encodeURIComponent(mediaFilename)}`;
  return link;
}
