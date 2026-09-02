import { randomUUID } from 'node:crypto';
import { config as appConfig } from '../config/index.js';
import type { CommunityModerationMode } from '../config/schema/community.js';
import { createLogger } from '../logging/logger.js';
import { APIError, ErrorCode } from '../utils/constants.js';
import { hmac } from '../analytics/index.js';
import { DbError } from '../db/errors.js';
import { CommunityRepository } from '../db/repositories/community.js';
import { isTrustedUuid } from '../db/repositories/users.js';
import { registerTemplateTrust } from '../utils/templates.js';
import type { Template } from '../db/schemas.js';
import { validateCommunityPayload } from './validators/index.js';
import { CommunityFederation } from './federation.js';
import { bumpPatch, compareVersions } from './version.js';
import type {
  CommunityBlock,
  CommunityBlockKind,
  CommunityIdentity,
  CommunityItem,
  CommunityItemMeta,
  CommunityItemMine,
  CommunityItemPublic,
  CommunityKind,
  CommunityListQuery,
} from './types.js';

export * from './types.js';
export { compareVersions, bumpPatch, SEMVER_PATTERN } from './version.js';
export { validateCommunityFormatter } from './validators/formatter.js';
export { validateCommunityTemplate } from './validators/template.js';
export { validateCommunityPayload } from './validators/index.js';
export { CommunityFederation, type RemoteSourceState } from './federation.js';

const logger = createLogger('community');

const DAY_MS = 86_400_000;

// SQLite's CURRENT_TIMESTAMP is UTC but carries no zone marker.
function normaliseSqlTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
}

/**
 * Identity for uploads and likes. Owner and vote keys are keyed hashes, so the
 * tables never hold a uuid or an address; `ipKey` is the already-normalised
 * client address (IPv6 collapsed to its subnet).
 */
export function communityIdentity(
  uuid: string,
  ipKey: string,
  createdAt: string | Date
): CommunityIdentity {
  if (!ipKey) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      400,
      'Client address unavailable, cannot take part in community sharing'
    );
  }
  const created =
    typeof createdAt === 'string'
      ? Date.parse(normaliseSqlTimestamp(createdAt))
      : createdAt.getTime();
  return {
    ownerHash: hmac(uuid),
    ipHash: hmac(`ip:${ipKey}`),
    accountAgeMs: Number.isFinite(created)
      ? Math.max(0, Date.now() - created)
      : 0,
    trusted: isTrustedUuid(uuid),
  };
}

function toPublic(item: CommunityItem): CommunityItemPublic {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.description,
    author: item.author,
    version: item.version,
    tags: item.tags,
    payload: publicPayload(item),
    likes: item.likes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    trusted: item.trusted || undefined,
  };
}

function toMine(item: CommunityItem): CommunityItemMine {
  return {
    ...toPublic(item),
    status: item.status,
    rejectionReason: item.rejectionReason,
    draftRejectionReason: item.draft ? undefined : item.draftRejectionReason,
    draft: item.draft
      ? {
          version: item.draft.version,
          submittedAt: item.draft.submittedAt,
          rejectionReason: item.draftRejectionReason,
        }
      : undefined,
  };
}

/** Templates carry their row identity in metadata so applied-template tracking stays stable. */
function publicPayload(item: CommunityItem): unknown {
  if (item.kind !== 'template') return item.payload;
  const template = item.payload as Template;
  return {
    ...template,
    metadata: {
      ...template.metadata,
      id: item.id,
      version: item.version,
      tags: item.tags,
      source: 'community',
    },
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof DbError && err.kind === 'unique-violation';
}

export class CommunityService {
  static mode(kind: CommunityKind): CommunityModerationMode {
    return kind === 'formatter'
      ? appConfig.community.formatters
      : appConfig.community.templates;
  }

  private static async require(id: string): Promise<CommunityItem> {
    const item = await CommunityRepository.get(id);
    if (!item) throw new APIError(ErrorCode.COMMUNITY_NOT_FOUND);
    return item;
  }

  private static async requireOwn(
    id: string,
    identity: CommunityIdentity
  ): Promise<CommunityItem> {
    const item = await this.require(id);
    // Same code as a missing row so ids cannot be probed for ownership.
    if (item.ownerHash !== identity.ownerHash) {
      throw new APIError(ErrorCode.COMMUNITY_NOT_FOUND);
    }
    return item;
  }

  private static async assertParticipant(
    kind: CommunityKind,
    identity: CommunityIdentity
  ): Promise<void> {
    if (this.mode(kind) === 'off')
      throw new APIError(ErrorCode.COMMUNITY_DISABLED);
    if (
      await CommunityRepository.isBlocked(identity.ownerHash, identity.ipHash)
    ) {
      throw new APIError(ErrorCode.COMMUNITY_BLOCKED);
    }
    if (identity.accountAgeMs < appConfig.community.minAccountAge * 1000) {
      throw new APIError(ErrorCode.COMMUNITY_ACCOUNT_TOO_NEW);
    }
  }

  private static async assertCanSubmit(
    kind: CommunityKind,
    identity: CommunityIdentity
  ): Promise<void> {
    await this.assertParticipant(kind, identity);
    const recent = await CommunityRepository.countByOwnerSince(
      identity.ownerHash,
      Date.now() - DAY_MS
    );
    if (recent >= appConfig.community.maxSubmissionsPerDay) {
      throw new APIError(ErrorCode.COMMUNITY_SUBMISSION_LIMIT);
    }
  }

  private static publishesDirectly(
    kind: CommunityKind,
    identity: CommunityIdentity
  ): boolean {
    return this.mode(kind) === 'open' || identity.trusted;
  }

  static async submit(
    kind: CommunityKind,
    meta: CommunityItemMeta,
    payload: unknown,
    identity: CommunityIdentity
  ): Promise<CommunityItemMine> {
    await this.assertCanSubmit(kind, identity);
    const validated = validateCommunityPayload(kind, payload);
    const id = randomUUID();
    const status = this.publishesDirectly(kind, identity)
      ? 'approved'
      : 'pending';
    await CommunityRepository.insert({
      id,
      kind,
      status,
      ownerHash: identity.ownerHash,
      ipHash: identity.ipHash,
      name: meta.name,
      description: meta.description,
      author: meta.author,
      version: meta.version ?? '1.0.0',
      tags: meta.tags ?? [],
      payload: validated.payload,
      reviewSummary: validated.reviewSummary,
      createdAt: Date.now(),
    });
    logger.info({ id, kind, status }, 'community item submitted');
    return toMine(await this.require(id));
  }

  /**
   * A new revision from the owner. Goes live at once unless the item is already
   * published and this instance moderates the kind, in which case it waits as a
   * draft so the published version stays available.
   */
  static async update(
    id: string,
    meta: Partial<CommunityItemMeta>,
    payload: unknown | undefined,
    identity: CommunityIdentity
  ): Promise<CommunityItemMine> {
    const item = await this.requireOwn(id, identity);
    await this.assertCanSubmit(item.kind, identity);
    const validated =
      payload === undefined
        ? { payload: item.payload, reviewSummary: item.reviewSummary }
        : validateCommunityPayload(item.kind, payload);
    const version = meta.version ?? bumpPatch(item.version);
    if (compareVersions(version, item.version) <= 0) {
      throw new APIError(ErrorCode.COMMUNITY_VERSION_NOT_NEWER);
    }
    const next = {
      name: meta.name ?? item.name,
      description: meta.description ?? item.description,
      author: meta.author ?? item.author,
      version,
      tags: meta.tags ?? item.tags,
      payload: validated.payload,
      reviewSummary: validated.reviewSummary,
    };
    const direct = this.publishesDirectly(item.kind, identity);
    if (direct || item.status !== 'approved') {
      await CommunityRepository.updateLive(id, {
        ...next,
        status: direct ? 'approved' : 'pending',
        updatedAt: Date.now(),
      });
    } else {
      await CommunityRepository.setDraft(id, {
        ...next,
        submittedAt: Date.now(),
      });
    }
    logger.info(
      { id, kind: item.kind, version, direct },
      'community item updated'
    );
    return toMine(await this.require(id));
  }

  static async withdrawDraft(
    id: string,
    identity: CommunityIdentity
  ): Promise<CommunityItemMine> {
    const item = await this.requireOwn(id, identity);
    if (item.draft) await CommunityRepository.setDraft(id, null);
    return toMine(await this.require(id));
  }

  static async removeOwn(
    id: string,
    identity: CommunityIdentity
  ): Promise<void> {
    await this.requireOwn(id, identity);
    await CommunityRepository.remove(id);
  }

  static async listMine(
    identity: CommunityIdentity
  ): Promise<CommunityItemMine[]> {
    const items = await CommunityRepository.listByOwner(identity.ownerHash);
    return items.map(toMine);
  }

  static async listPublic(kind: CommunityKind): Promise<CommunityItemPublic[]> {
    if (this.mode(kind) === 'off') return [];
    const items = await CommunityRepository.listApproved(kind);
    return [...items.map(toPublic), ...CommunityFederation.itemsOfKind(kind)];
  }

  /** Changes whenever a public list would: local approvals or a remote refresh. */
  static async listRevision(): Promise<string> {
    const local = await CommunityRepository.getExportRevision();
    return `${local}:${CommunityFederation.exportRevision}`;
  }

  /** Approved local items of both kinds, the shape remote instances mirror. */
  static async exportItems(): Promise<{
    version: 1;
    generatedAt: number;
    instance: string;
    items: CommunityItemPublic[];
  }> {
    const [formatters, templates] = await Promise.all([
      CommunityRepository.listApproved('formatter'),
      CommunityRepository.listApproved('template'),
    ]);
    return {
      version: 1,
      generatedAt: Date.now(),
      instance: appConfig.branding.addonName,
      items: [...formatters, ...templates].map(toPublic),
    };
  }

  static async toggleLike(
    id: string,
    identity: CommunityIdentity
  ): Promise<{ liked: boolean; likes: number }> {
    const item = await this.require(id);
    if (item.status !== 'approved')
      throw new APIError(ErrorCode.COMMUNITY_NOT_FOUND);
    await this.assertParticipant(item.kind, identity);
    const existing = await CommunityRepository.findLike(
      id,
      identity.ownerHash,
      identity.ipHash
    );
    if (existing?.ownerHash === identity.ownerHash) {
      await CommunityRepository.removeLike(id, identity.ownerHash);
      return {
        liked: false,
        likes: await CommunityRepository.recountLikes(id),
      };
    }
    if (existing) throw new APIError(ErrorCode.COMMUNITY_ALREADY_LIKED);
    try {
      await CommunityRepository.addLike(
        id,
        identity.ownerHash,
        identity.ipHash
      );
    } catch (err) {
      if (isUniqueViolation(err))
        throw new APIError(ErrorCode.COMMUNITY_ALREADY_LIKED);
      throw err;
    }
    return { liked: true, likes: await CommunityRepository.recountLikes(id) };
  }

  // --- moderation ---------------------------------------------------------

  static list(q: CommunityListQuery) {
    return CommunityRepository.list(q);
  }

  static get(id: string) {
    return this.require(id);
  }

  static async approve(
    id: string,
    opts: { trusted?: boolean } = {}
  ): Promise<CommunityItem> {
    await this.require(id);
    await CommunityRepository.setStatus(id, 'approved');
    if (opts.trusted !== undefined) {
      await CommunityRepository.setTrusted(id, opts.trusted);
    }
    const item = await this.require(id);
    if (item.trusted) this.registerTrust(item);
    return item;
  }

  static async reject(id: string, reason: string): Promise<CommunityItem> {
    await this.require(id);
    await CommunityRepository.setStatus(id, 'rejected', reason);
    return this.require(id);
  }

  static async approveDraft(id: string): Promise<CommunityItem> {
    const item = await this.require(id);
    if (!item.draft) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        'This item has no pending update'
      );
    }
    const updated = await CommunityRepository.promoteDraft(id);
    if (updated?.trusted) this.registerTrust(updated);
    return this.require(id);
  }

  static async rejectDraft(id: string, reason: string): Promise<CommunityItem> {
    const item = await this.require(id);
    if (!item.draft) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        'This item has no pending update'
      );
    }
    await CommunityRepository.setDraft(id, null, reason);
    return this.require(id);
  }

  static async remove(id: string): Promise<boolean> {
    return CommunityRepository.remove(id);
  }

  static async setTrusted(
    id: string,
    trusted: boolean
  ): Promise<CommunityItem> {
    await this.require(id);
    await CommunityRepository.setTrusted(id, trusted);
    const item = await this.require(id);
    if (trusted && item.status === 'approved') this.registerTrust(item);
    return item;
  }

  static async resetLikes(id: string): Promise<void> {
    await this.require(id);
    await CommunityRepository.resetLikes(id);
  }

  static async blockOwnerOf(itemId: string, reason?: string): Promise<void> {
    const item = await this.require(itemId);
    await CommunityRepository.addBlock(item.ownerHash, 'owner', reason);
  }

  static async blockIpOf(itemId: string, reason?: string): Promise<void> {
    const item = await this.require(itemId);
    await CommunityRepository.addBlock(item.ipHash, 'ip', reason);
  }

  static listBlocks(): Promise<CommunityBlock[]> {
    return CommunityRepository.listBlocks();
  }

  static addBlock(hash: string, kind: CommunityBlockKind, reason?: string) {
    return CommunityRepository.addBlock(hash, kind, reason);
  }

  static removeBlock(hash: string): Promise<boolean> {
    return CommunityRepository.removeBlock(hash);
  }

  /** Approved templates an admin marked trusted join the regex/URL whitelists like data-dir templates. */
  static async registerTrustedOnBoot(): Promise<void> {
    const items = await CommunityRepository.listTrusted('template');
    if (items.length === 0) return;
    registerTemplateTrust(items.map((item) => item.payload as Template));
    logger.info(
      { count: items.length },
      'registered trusted community templates'
    );
  }

  private static registerTrust(item: CommunityItem): void {
    if (item.kind !== 'template') return;
    registerTemplateTrust([item.payload as Template]);
  }
}
