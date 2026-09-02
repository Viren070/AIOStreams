import {
  MAX_COMMUNITY_TAGS,
  MAX_COMMUNITY_TAG_LENGTH,
} from '../../../core/src/community/types';

/** Comma-separated user input to a bounded, deduplicated, lowercase tag list. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(',')) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_COMMUNITY_TAG_LENGTH);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_COMMUNITY_TAGS) break;
  }
  return [...seen];
}

export { MAX_COMMUNITY_TAGS, MAX_COMMUNITY_TAG_LENGTH };
