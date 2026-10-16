import { randomBytes } from 'crypto';
import type { SharedKind } from './types.js';

export const replicaId = () => randomBytes(6).toString('base64url');

export interface Index {
  tags: readonly string[];
  refs: readonly string[];
}

export const NO_INDEX: Index = { tags: [], refs: [] };

export function indexOf<L>(kind: SharedKind<L>, live: L): Index {
  return { tags: kind.tags(live), refs: kind.refs?.(live) ?? [] };
}

export function diff(
  before: readonly string[],
  after: readonly string[],
  added: (value: string) => void,
  removed: (value: string) => void
): void {
  for (const value of after) if (!before.includes(value)) added(value);
  for (const value of before) if (!after.includes(value)) removed(value);
}
