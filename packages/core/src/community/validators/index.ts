import { validateCommunityFormatter } from './formatter.js';
import { validateCommunityTemplate } from './template.js';
import type { CommunityKind } from '../types.js';

export interface ValidatedPayload {
  payload: unknown;
  reviewSummary?: unknown;
}

const validators: Record<
  CommunityKind,
  (payload: unknown) => ValidatedPayload
> = {
  formatter: (payload) => ({ payload: validateCommunityFormatter(payload) }),
  template: validateCommunityTemplate,
};

/** Throws `COMMUNITY_INVALID_ITEM` when the payload is not acceptable for its kind. */
export function validateCommunityPayload(
  kind: CommunityKind,
  payload: unknown
): ValidatedPayload {
  return validators[kind](payload);
}
