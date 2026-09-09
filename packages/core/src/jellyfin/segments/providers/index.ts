import type { SegmentProviderId } from '../../../utils/constants.js';
import type { SegmentProvider } from '../types.js';
import { aniSkipProvider } from './aniskip.js';
import { animeSkipProvider } from './animeskip.js';
import { introDbProvider } from './introdb.js';

/**
 * Every provider, keyed on its id. The record is typed on the id union from
 * `constants.SEGMENT_PROVIDERS`, so adding an id there without a provider here
 * fails to compile. Order is the operator's, not this file's.
 */
export const SEGMENT_PROVIDER_REGISTRY: Record<
  SegmentProviderId,
  SegmentProvider
> = {
  introdb: introDbProvider,
  aniskip: aniSkipProvider,
  animeskip: animeSkipProvider,
};

export { aniSkipProvider, animeSkipProvider, introDbProvider };
