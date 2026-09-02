import { config as appConfig } from '../config/index.js';
import {
  LinkedAccountRepository,
  MAX_LINKED_ACCOUNTS_PER_USER,
} from '../db/repositories/linked-accounts.js';
import { APIError, ErrorCode } from '../utils/constants.js';
import { createLogger } from '../logging/logger.js';
import { manifestSetFingerprint } from '../utils/manifest-fingerprint.js';
import { requestJson } from './http.js';
import {
  assertOwnManifestUrl,
  assertOwnManifestUrls,
  type OwnManifestUrl,
} from './manifest-urls.js';
import { getPlatform } from './registry.js';
import type {
  LinkedAccount,
  LinkedAccountPlatformId,
  ProbeResult,
  PushResult,
  ResolvedManifest,
} from './types.js';

const logger = createLogger('linked-accounts');

function assertEnabled(): void {
  if (!appConfig.linkedAccounts.enabled) {
    throw new APIError(
      ErrorCode.FORBIDDEN,
      403,
      'Linked accounts are disabled on this instance.'
    );
  }
}

function notFound(): never {
  throw new APIError(
    ErrorCode.BAD_REQUEST,
    404,
    'That linked account does not exist.'
  );
}

export class LinkedAccountService {
  static async list(uuid: string): Promise<LinkedAccount[]> {
    return LinkedAccountRepository.list(uuid);
  }

  static async probe(
    platform: string,
    input: { instanceUrl?: string }
  ): Promise<ProbeResult> {
    assertEnabled();
    return getPlatform(platform).probe(input);
  }

  static async link(
    uuid: string,
    platform: string,
    input: Record<string, unknown>,
    manifestUrls: string[],
    label?: string
  ): Promise<LinkedAccount> {
    assertEnabled();

    if (
      (await LinkedAccountRepository.countForUser(uuid)) >=
      MAX_LINKED_ACCOUNTS_PER_USER
    ) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        `You can link at most ${MAX_LINKED_ACCOUNTS_PER_USER} accounts.`
      );
    }

    const urls = await assertOwnManifestUrls(manifestUrls, uuid);
    const driver = getPlatform(platform);
    const connected = await driver.connect(input);

    return LinkedAccountRepository.create({
      uuid,
      platform: driver.id as LinkedAccountPlatformId,
      label: (label?.trim() || connected.label).slice(0, 64),
      identity: connected.identity,
      credentials: connected.credentials,
      config: {
        ...connected.config,
        manifestUrls: urls.map((entry) => entry.url),
      },
    });
  }

  static async update(
    uuid: string,
    id: string,
    patch: { label?: string; autoPush?: boolean; manifestUrls?: string[] }
  ): Promise<LinkedAccount> {
    assertEnabled();
    const existing = await LinkedAccountRepository.get(uuid, id);
    if (!existing) notFound();

    const config =
      patch.manifestUrls === undefined
        ? undefined
        : {
            ...existing.config,
            manifestUrls: await keepStoredUrls(
              await assertOwnManifestUrls(patch.manifestUrls, uuid),
              existing.config.manifestUrls,
              uuid
            ),
          };

    const updated = await LinkedAccountRepository.update(uuid, id, {
      label: patch.label?.trim().slice(0, 64) || undefined,
      autoPush: patch.autoPush,
      config,
    });
    if (!updated) notFound();
    return updated;
  }

  static async unlink(uuid: string, id: string): Promise<void> {
    const account = await LinkedAccountRepository.resolve(uuid, id);
    if (!account) notFound();

    try {
      await getPlatform(account.platform).revoke?.(account);
    } catch (error) {
      logger.warn(
        {
          platform: account.platform,
          error: error instanceof Error ? error.message : String(error),
        },
        'could not withdraw credential on unlink'
      );
    }

    if (!(await LinkedAccountRepository.remove(uuid, id))) notFound();
  }

  /**
   * Pushes one destination. Failures are recorded on the row and rethrown, so
   * a caller pushing several can report per-destination results.
   */
  static async push(uuid: string, id: string): Promise<PushResult> {
    assertEnabled();
    const account = await LinkedAccountRepository.resolve(uuid, id);
    if (!account) notFound();

    // Re-validated on every push: a password change rotates the encrypted
    // password in the URL, and an alias can be reassigned.
    const urls = await assertOwnManifestUrls(account.config.manifestUrls, uuid);

    try {
      // Fetched here rather than in each driver: Stremio needs the manifest to
      // store, and the fingerprint has to describe exactly what was pushed.
      const manifests = await fetchManifests(urls);
      const result = await getPlatform(account.platform).push(
        account,
        manifests
      );
      await LinkedAccountRepository.recordPush(uuid, id, {
        status: 'ok',
        manifestHash: manifestSetFingerprint(manifests.map((m) => m.manifest)),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const expired = error instanceof APIError && error.statusCode === 401;
      await LinkedAccountRepository.recordPush(uuid, id, {
        status: expired ? 'expired' : 'error',
        error: message.slice(0, 500),
      });
      logger.warn(
        { platform: account.platform, error: message },
        'push to linked account failed'
      );
      throw error;
    }
  }

  /** Used by the save flow when the user has opted into automatic pushes. */
  static async pushAll(
    uuid: string
  ): Promise<
    Array<{ id: string; label: string; ok: boolean; error?: string }>
  > {
    const accounts = (await LinkedAccountRepository.list(uuid)).filter(
      (account) => account.autoPush
    );
    const results = [];
    for (const account of accounts) {
      try {
        await this.push(uuid, account.id);
        results.push({ id: account.id, label: account.label, ok: true });
      } catch (error) {
        results.push({
          id: account.id,
          label: account.label,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
}

/**
 * Keeps the URL already on the row when the incoming one names the same addon.
 * The configure page rebuilds every URL from the session's encrypted password,
 * which is minted fresh each time, so an edit that only renames the account
 * would otherwise hand the platform a URL it has never seen.
 */
async function keepStoredUrls(
  incoming: OwnManifestUrl[],
  stored: string[],
  uuid: string
): Promise<string[]> {
  const known = new Map<string, string>();
  for (const url of stored) {
    try {
      const entry = await assertOwnManifestUrl(url, uuid);
      known.set(entry.identity, entry.url);
    } catch {
      // A stored URL that no longer validates has nothing worth keeping.
    }
  }
  return incoming.map((entry) => known.get(entry.identity) ?? entry.url);
}

async function fetchManifests(
  urls: OwnManifestUrl[]
): Promise<ResolvedManifest[]> {
  const resolved: ResolvedManifest[] = [];
  for (const { url, fetchUrl } of urls) {
    const { status, json, redirected } =
      await requestJson<Record<string, unknown>>(fetchUrl);
    if (
      redirected ||
      status >= 400 ||
      !json?.id ||
      !json?.name ||
      !json?.version
    ) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        `Could not read a valid manifest from ${url}.`
      );
    }
    resolved.push({
      url,
      manifest: {
        ...json,
        types: Array.isArray(json.types) ? json.types : [],
        resources: Array.isArray(json.resources) ? json.resources : [],
      },
    });
  }
  return resolved;
}
