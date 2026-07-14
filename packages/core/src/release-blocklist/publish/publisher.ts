import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createLogger } from '../../logging/logger.js';
import { ReleaseBlocklistRepository } from '../../db/repositories/release-blocklist.js';
import { ReleaseBlocklistPublishRepository } from '../../db/repositories/release-blocklist-publish.js';
import { LOCAL_SOURCE_ID, type BlocklistRecord } from '../types.js';
import { toNativeNdjson, toWardenNdjson } from '../io.js';
import {
  checkArtifactsAgainstCapabilities,
  getPublishProvider,
  type PublishFile,
} from './provider.js';
import { decodePublishConfig, encodePublishConfig } from './config.js';
import { formatBytes } from '../../formatters/utils.js';
import {
  artifactFilename,
  artifactKey,
  PUBLISH_ERROR_PREFIX,
  type PublishArtifactKey,
  type PublishArtifactSpec,
  type PublishScope,
  type PublishTarget,
  type PublishTargetState,
} from './types.js';

const logger = createLogger('release-blocklist');

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface PreparedArtifact {
  spec: PublishArtifactSpec;
  key: PublishArtifactKey;
  filename: string;
  body: string;
  hash: string;
}

export class ReleaseBlocklistPublishService {
  /** Joins a concurrent "Push now" with an already-running push. */
  private static inflight = new Map<string, Promise<string>>();

  /**
   * Push one target: serialize every artifact, skip when nothing changed
   * since the last push (unless forced), otherwise upload the changed files
   * and persist per-artifact state. Returns a short status string, also
   * persisted on the target.
   */
  static async publishOne(
    target: PublishTarget,
    opts: { force?: boolean } = {}
  ): Promise<string> {
    const running = this.inflight.get(target.id);
    if (running) return running;
    const task = this.publishOneInner(target, opts).finally(() => {
      this.inflight.delete(target.id);
    });
    this.inflight.set(target.id, task);
    return task;
  }

  private static async publishOneInner(
    target: PublishTarget,
    opts: { force?: boolean }
  ): Promise<string> {
    const checkedAt = nowSeconds();
    try {
      const provider = getPublishProvider(target.provider);
      if (!provider) {
        throw new Error(`unknown provider "${target.provider}"`);
      }
      const config = decodePublishConfig(target.configEnc);
      if (!config) {
        throw new Error(
          'stored config cannot be decrypted (was SECRET_KEY changed?)'
        );
      }
      const capabilityProblem = checkArtifactsAgainstCapabilities(
        provider,
        target.artifacts
      );
      if (capabilityProblem) throw new Error(capabilityProblem);

      // getEntries has no ORDER BY; sorting makes serialization (and with
      // it the change-detection hash) deterministic across dialects.
      const recordsByScope = new Map<PublishScope, BlocklistRecord[]>();
      const recordsForScope = async (scope: PublishScope) => {
        let records = recordsByScope.get(scope);
        if (!records) {
          records =
            scope === 'local'
              ? await ReleaseBlocklistRepository.getEntries([LOCAL_SOURCE_ID])
              : await ReleaseBlocklistRepository.getEntries(undefined, true);
          records.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
          recordsByScope.set(scope, records);
        }
        return records;
      };

      const prepared: PreparedArtifact[] = [];
      for (const spec of target.artifacts) {
        const records = await recordsForScope(spec.scope);
        const body =
          spec.format === 'warden'
            ? toWardenNdjson(records)
            : toNativeNdjson(records);
        prepared.push({
          spec,
          key: artifactKey(spec),
          filename: artifactFilename(spec),
          body,
          hash: createHash('sha256').update(body, 'utf8').digest('hex'),
        });
      }

      const changed = opts.force
        ? prepared
        : prepared.filter((p) => target.state[p.key]?.hash !== p.hash);
      if (changed.length === 0) {
        const status = 'Up to date';
        await ReleaseBlocklistPublishRepository.setStatus(target.id, {
          status,
          lastChecked: checkedAt,
        });
        return status;
      }

      const files: PublishFile[] = changed.map((p) => ({
        artifactKey: p.key,
        filename: p.filename,
        content: p.spec.gzip
          ? gzipSync(Buffer.from(p.body, 'utf8'))
          : Buffer.from(p.body, 'utf8'),
        contentType: p.spec.gzip
          ? 'application/gzip'
          : 'application/x-ndjson; charset=utf-8',
      }));
      const maxBytes = provider.capabilities.maxBytesPerFile;
      if (maxBytes) {
        for (const file of files) {
          if (file.content.length > maxBytes) {
            const hint = provider.capabilities.binary
              ? 'Compress it, narrow its scope, or use a provider with a higher limit.'
              : `${provider.label} cannot take compressed files, so narrow its scope or use a provider with a higher limit.`;
            throw new Error(
              `${file.filename} is ${formatBytes(file.content.length, 1024)}, over the ${provider.label} limit of ${formatBytes(maxBytes, 1024)}. ${hint}`
            );
          }
        }
      }

      const outcome = await provider.publish(config, files);

      // Persist configPatch (e.g. a freshly created gist id) before the
      // state write so a later failure cannot orphan the created resource.
      // Read-merge-write so a concurrent PATCH's config is not clobbered.
      if (outcome.configPatch && Object.keys(outcome.configPatch).length > 0) {
        const fresh = await ReleaseBlocklistPublishRepository.getTarget(
          target.id
        );
        if (fresh) {
          const current = decodePublishConfig(fresh.configEnc) ?? config;
          await ReleaseBlocklistPublishRepository.updateTarget(target.id, {
            configEnc: encodePublishConfig({
              ...current,
              ...outcome.configPatch,
            }),
          });
        }
      }

      const newState: PublishTargetState = { ...target.state };
      for (const p of changed) {
        const url = outcome.urls[p.filename];
        newState[p.key] = {
          hash: p.hash,
          pushedAt: checkedAt,
          ...(url ? { url } : {}),
        };
      }
      for (const key of Object.keys(newState) as PublishArtifactKey[]) {
        if (!target.artifacts.some((a) => artifactKey(a) === key)) {
          delete newState[key];
        }
      }
      await ReleaseBlocklistPublishRepository.setState(target.id, newState);

      const status = `Pushed ${changed.length}/${prepared.length} file${prepared.length === 1 ? '' : 's'}`;
      await ReleaseBlocklistPublishRepository.setStatus(target.id, {
        status,
        lastChecked: checkedAt,
        lastPushed: checkedAt,
      });
      logger.info(
        `published blocklist target "${target.name}" (${target.provider}): ${changed.length} file(s)`
      );
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = `${PUBLISH_ERROR_PREFIX}${message}`;
      await ReleaseBlocklistPublishRepository.setStatus(target.id, {
        status,
        lastChecked: checkedAt,
      }).catch(() => {});
      logger.warn(
        { err },
        `failed to publish blocklist target "${target.name}" (${target.provider}): ${message}`
      );
      return status;
    }
  }

  /** Push every enabled target whose interval has elapsed. */
  static async publishDue(): Promise<{ ok: boolean; message: string }> {
    const due = await ReleaseBlocklistPublishRepository.getDue(nowSeconds());
    if (due.length === 0) {
      return { ok: true, message: 'no targets due' };
    }
    let failures = 0;
    for (const target of due) {
      const status = await this.publishOne(target);
      if (status.startsWith(PUBLISH_ERROR_PREFIX)) failures++;
    }
    return {
      ok: failures === 0,
      message: `pushed ${due.length - failures}/${due.length} due targets`,
    };
  }
}
