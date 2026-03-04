export interface ChangelogEntry {
  version: string;
  date: string;
  content: string;
}

/** Module-level cache: URL → parsed entries */
const CHANGELOG_URL_CACHE = new Map<string, ChangelogEntry[]>();

/**
 * Parses a CHANGELOG.md string into structured entries.
 *
 * Expected format:
 * ```
 * # Changelog
 *
 * ## 2.0.7 (2026-03-03)
 * Content here...
 *
 * ## 2.0.6 (2026-02-15)
 * Content here...
 * ```
 */
export function parseChangelogMd(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  // Match "## <version> (<date>)" headings
  const sectionRegex = /^## +([^\s(]+)\s*\(([^)]+)\)\s*$/gm;
  const sections: Array<{
    version: string;
    date: string;
    headerEnd: number;
    nextStart: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({
      version: match[1],
      date: match[2].trim(),
      headerEnd: match.index + match[0].length,
      nextStart: match.index,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const contentStart = section.headerEnd;
    const contentEnd =
      i + 1 < sections.length ? sections[i + 1].nextStart : content.length;
    const sectionContent = content.slice(contentStart, contentEnd).trim();
    entries.push({
      version: section.version,
      date: section.date,
      content: sectionContent,
    });
  }

  return entries;
}

/**
 * Fetches and parses a remote CHANGELOG.md file.
 * Results are cached by URL so repeated calls don't re-fetch.
 */
export async function fetchAndParseChangelog(
  url: string
): Promise<ChangelogEntry[]> {
  const cached = CHANGELOG_URL_CACHE.get(url);
  if (cached !== undefined) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch changelog from ${url}: HTTP ${response.status}`
    );
  }

  const text = await response.text();
  const entries = parseChangelogMd(text);
  CHANGELOG_URL_CACHE.set(url, entries);
  return entries;
}
