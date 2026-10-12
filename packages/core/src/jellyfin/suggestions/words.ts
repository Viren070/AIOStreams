import { cleanTitle } from '../../parser/utils.js';
import type { TitleSuggestion } from './types.js';

/** A title's words without accents, case or punctuation, for prefix matching. */
export function titleWords(text: string): string[] {
  const cleaned = cleanTitle(text);
  return cleaned ? cleaned.split(' ') : [];
}

export function completes(words: string[], typed: string[]): boolean {
  return typed.every((t) => words.some((w) => w.startsWith(t)));
}

/** The first suggestion of each name, so remakes and namesakes don't fill the list. */
export function distinctNames(
  suggestions: Iterable<TitleSuggestion>
): TitleSuggestion[] {
  const seen = new Set<string>();
  const out: TitleSuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = cleanTitle(suggestion.name).replaceAll(' ', '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
  }
  return out;
}
