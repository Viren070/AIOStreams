export type CommunityKind = 'formatter' | 'template';
export type CommunityStatus = 'pending' | 'approved' | 'rejected';
export type CommunityBlockKind = 'owner' | 'ip';

/** A submitted revision that is waiting for review while the live one stays published. */
export interface CommunityDraft {
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  payload: unknown;
  reviewSummary?: unknown;
  submittedAt: number;
}

/** Full row. Hashes never leave the dashboard API. */
export interface CommunityItem {
  id: string;
  kind: CommunityKind;
  status: CommunityStatus;
  ownerHash: string;
  ipHash: string;
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  payload: unknown;
  reviewSummary?: unknown;
  draft?: CommunityDraft;
  draftRejectionReason?: string;
  trusted: boolean;
  likes: number;
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number;
}

/** What every visitor sees. */
export interface CommunityItemPublic {
  id: string;
  kind: CommunityKind;
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  payload: unknown;
  likes: number;
  createdAt: number;
  updatedAt: number;
  trusted?: boolean;
  federated?: boolean;
  origin?: string;
}

/** What the owner sees about their own submissions. */
export interface CommunityItemMine extends CommunityItemPublic {
  status: CommunityStatus;
  rejectionReason?: string;
  /** Why the last proposed update was turned down; the live version is unaffected. */
  draftRejectionReason?: string;
  draft?: {
    version: string;
    submittedAt: number;
    rejectionReason?: string;
  };
}

export interface CommunityBlock {
  hash: string;
  kind: CommunityBlockKind;
  reason?: string;
  createdAt: number;
}

export interface CommunityListQuery {
  kind?: CommunityKind;
  status?: CommunityStatus;
  /** Case-insensitive substring match on name, description and author. */
  search?: string;
  /** Rows waiting for review: never-approved items and items with a draft. */
  pending?: boolean;
  limit?: number;
  offset?: number;
}

export interface CommunityItemMeta {
  name: string;
  description: string;
  author: string;
  version?: string;
  tags?: string[];
}

export const MAX_COMMUNITY_TAGS = 5;
export const MAX_COMMUNITY_TAG_LENGTH = 20;

export interface CommunityIdentity {
  ownerHash: string;
  ipHash: string;
  accountAgeMs: number;
  trusted: boolean;
}
