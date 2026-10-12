import type { SuggestionProviderId } from '../../../utils/constants.js';
import type { SuggestionProvider } from '../types.js';
import { cinemetaProvider } from './cinemeta.js';
import { lumiereDbProvider } from './lumieredb.js';

/** Typed on `constants.SUGGESTION_PROVIDERS`, so an id without a provider here fails to compile. */
export const SUGGESTION_PROVIDER_REGISTRY: Record<
  SuggestionProviderId,
  SuggestionProvider
> = {
  lumieredb: lumiereDbProvider,
  cinemeta: cinemetaProvider,
};
