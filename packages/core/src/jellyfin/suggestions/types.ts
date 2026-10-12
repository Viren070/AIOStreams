import type { SuggestionProviderId } from '../../utils/constants.js';
import type { ContentKind } from '../library.js';

export interface TitleSuggestion {
  /** An IMDb id. */
  id: string;
  type: ContentKind;
  name: string;
  year?: number;
}

export interface SuggestionQuery {
  /** As typed, trimmed. */
  term: string;
  /** The term's words, folded as {@link titleWords} folds titles. */
  words: string[];
  kinds: readonly ContentKind[];
  limit: number;
}

export interface SuggestionProvider {
  id: SuggestionProviderId;
  name: string;
  /** Absent means it needs no setup. */
  configured?(): boolean;
  /** Set to keep each query's answer for this many seconds. */
  readonly cacheTtl?: number;
  /** Best first, in any number; the caller trims them. Throwing marks the provider down for a while. */
  suggest(query: SuggestionQuery): Promise<TitleSuggestion[]>;
}
