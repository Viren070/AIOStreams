import { SettingsRepository } from '../db/repositories/settings.js';
import { ScreenerStore } from '../db/repositories/screener.js';
import { encryptString, decryptString } from '../utils/crypto.js';
import { makeRequest } from '../utils/http.js';
import { createLogger } from '../logging/logger.js';
import { toNdjson, toDavexNdjson } from './io.js';

const logger = createLogger('screener');

const SETTINGS_KEY = 'screener.github-sync';
const GITHUB_API = 'https://api.github.com';
const SYNC_TIMEOUT_MS = 30_000;

const nowSec = () => Math.floor(Date.now() / 1000);

export interface GitHubSyncConfig {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  format: 'native' | 'davex';
  scope: 'local' | 'all';
  // Auto-sync cadence in seconds; 0 means manual-only (Sync now).
  intervalSeconds: number;
}

interface StoredSyncConfig extends GitHubSyncConfig {
  // AES-encrypted personal access token, or null when none is set.
  tokenEnc: string | null;
  lastSyncAt: number | null;
  lastStatus: string | null;
}

// What the API/UI sees: the config plus whether a token is on file and the
// raw URL subscribers point at. The token itself never leaves the server.
export interface GitHubSyncView extends GitHubSyncConfig {
  hasToken: boolean;
  rawUrl: string | null;
  lastSyncAt: number | null;
  lastStatus: string | null;
}

export interface GitHubSyncInput extends Partial<GitHubSyncConfig> {
  // undefined keeps the stored token; '' or null clears it; a string sets it.
  token?: string | null;
}

const DEFAULTS: StoredSyncConfig = {
  enabled: false,
  owner: '',
  repo: '',
  branch: 'main',
  path: 'screener.ndjson',
  format: 'native',
  scope: 'local',
  intervalSeconds: 0,
  tokenEnc: null,
  lastSyncAt: null,
  lastStatus: null,
};

// GitHub's Contents path keeps its slashes but each segment is escaped.
function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function rawUrlFor(c: GitHubSyncConfig): string | null {
  const path = c.path.split('/').filter(Boolean).join('/');
  if (!c.owner || !c.repo || !path) return null;
  return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${path}`;
}

class ScreenerGitHubSyncServiceImpl {
  private async load(): Promise<StoredSyncConfig> {
    const raw = (await SettingsRepository.get(SETTINGS_KEY)) as
      | Partial<StoredSyncConfig>
      | undefined;
    return { ...DEFAULTS, ...(raw ?? {}) };
  }

  private toView(c: StoredSyncConfig): GitHubSyncView {
    const { tokenEnc, ...rest } = c;
    return { ...rest, hasToken: !!tokenEnc, rawUrl: rawUrlFor(c) };
  }

  async getConfig(): Promise<GitHubSyncView> {
    return this.toView(await this.load());
  }

  async setConfig(input: GitHubSyncInput): Promise<GitHubSyncView> {
    const next = await this.load();
    if (input.enabled !== undefined) next.enabled = input.enabled;
    if (input.owner !== undefined) next.owner = input.owner.trim();
    if (input.repo !== undefined) next.repo = input.repo.trim();
    if (input.branch !== undefined) next.branch = input.branch.trim() || 'main';
    if (input.path !== undefined)
      next.path = input.path.split('/').filter(Boolean).join('/') || 'screener.ndjson';
    if (input.format !== undefined) next.format = input.format;
    if (input.scope !== undefined) next.scope = input.scope;
    if (input.intervalSeconds !== undefined)
      next.intervalSeconds = Math.max(0, Math.floor(input.intervalSeconds));

    if (input.token === null || input.token?.trim() === '') {
      next.tokenEnc = null;
    } else if (typeof input.token === 'string') {
      const enc = encryptString(input.token.trim());
      if (!enc.success || !enc.data) {
        throw new Error('Failed to encrypt the GitHub token.');
      }
      next.tokenEnc = enc.data;
    }

    await SettingsRepository.set(SETTINGS_KEY, next);
    return this.toView(next);
  }

  private syncInFlight: Promise<string> | null = null;

  // Build the export and push it to the configured repo. Returns a short status
  // and persists it (success or failure) so the UI can show the last result.
  // Serialised so a manual "Sync now" and the scheduler can't push concurrently
  // and race on the file's blob sha.
  async sync(): Promise<string> {
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = this.runSync();
    try {
      return await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  private async runSync(): Promise<string> {
    const c = await this.load();
    let status: string;
    try {
      status = await this.push(c);
    } catch (err) {
      status = `error: ${err instanceof Error ? err.message : String(err)}`;
      await this.saveStatus(status);
      throw err;
    }
    await this.saveStatus(status);
    return status;
  }

  // Scheduler entry: push only when enabled and the configured interval has
  // elapsed. Errors are swallowed (sync() already records them) so the task
  // loop keeps running.
  async syncIfDue(): Promise<string> {
    const c = await this.load();
    if (!c.enabled) return 'disabled';
    if (!c.intervalSeconds || c.intervalSeconds <= 0) return 'manual only';
    const dueAt = (c.lastSyncAt ?? 0) + c.intervalSeconds;
    if (nowSec() < dueAt) return 'not due';
    try {
      return await this.sync();
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async saveStatus(status: string): Promise<void> {
    // Re-read so a settings change during the (network-bound) push isn't
    // clobbered by a stale copy captured before it started.
    const latest = await this.load();
    await SettingsRepository.set(SETTINGS_KEY, {
      ...latest,
      lastSyncAt: nowSec(),
      lastStatus: status,
    });
  }

  private async push(c: StoredSyncConfig): Promise<string> {
    if (!c.owner || !c.repo || !c.path) {
      throw new Error('owner, repo and path are required.');
    }
    if (!c.tokenEnc) throw new Error('A GitHub token is required.');
    const dec = decryptString(c.tokenEnc);
    if (!dec.success || !dec.data) {
      throw new Error('The stored token could not be decrypted.');
    }
    const token = dec.data;

    const ids =
      c.scope === 'all'
        ? (await ScreenerStore.getSources()).map((s) => s.id)
        : ['local'];
    const records = await ScreenerStore.getEntries(ids, true);
    const body =
      c.format === 'davex'
        ? toDavexNdjson(records, nowSec())
        : toNdjson(records, nowSec());
    const contentB64 = Buffer.from(body, 'utf8').toString('base64');

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aiostreams-screener',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
    const repoBase = `${GITHUB_API}/repos/${encodeURIComponent(
      c.owner
    )}/${encodeURIComponent(c.repo)}`;
    const treePath = c.path.split('/').filter(Boolean).join('/');
    const branchRef = `heads/${encodeURIComponent(c.branch)}`;
    const message = `screener: update ${records.length} entries`;

    // A shared list reaches tens of MB, which the Contents API rejects (its
    // request-body cap is well below that, so the PUT fails with HTTP 400). Push
    // via the Git Data API instead — blobs accept up to 100 MB — creating a blob,
    // a tree, a commit, then moving the branch ref. The file stays plain ndjson.
    const ref = await makeRequest(`${repoBase}/git/ref/${branchRef}`, {
      method: 'GET',
      timeout: SYNC_TIMEOUT_MS,
      headers,
    });
    if (ref.status === 404) {
      // No branch yet (empty repo): create the initial file via the Contents API,
      // which also creates the branch. First push only, so it's the small case.
      const put = await makeRequest(
        `${repoBase}/contents/${encodePath(treePath)}`,
        {
          method: 'PUT',
          timeout: SYNC_TIMEOUT_MS,
          headers: jsonHeaders,
          body: JSON.stringify({ message, content: contentB64, branch: c.branch }),
        }
      );
      if (put.status !== 200 && put.status !== 201) {
        throw new Error(await githubError('write', put));
      }
      logger.info(`Screener: created list with ${records.length} entries`);
      return `synced ${records.length} entries`;
    }
    if (ref.status !== 200) throw new Error(await githubError('read ref', ref));
    const baseCommitSha = ((await ref.json()) as { object?: { sha?: string } })
      ?.object?.sha;
    if (!baseCommitSha) throw new Error('GitHub read ref returned no commit sha');

    const baseCommit = await makeRequest(
      `${repoBase}/git/commits/${baseCommitSha}`,
      { method: 'GET', timeout: SYNC_TIMEOUT_MS, headers }
    );
    if (baseCommit.status !== 200) {
      throw new Error(await githubError('read commit', baseCommit));
    }
    const baseTreeSha = (
      (await baseCommit.json()) as { tree?: { sha?: string } }
    )?.tree?.sha;
    if (!baseTreeSha) throw new Error('GitHub read commit returned no tree sha');

    const blob = await makeRequest(`${repoBase}/git/blobs`, {
      method: 'POST',
      timeout: SYNC_TIMEOUT_MS,
      headers: jsonHeaders,
      body: JSON.stringify({ content: contentB64, encoding: 'base64' }),
    });
    if (blob.status !== 201) throw new Error(await githubError('write blob', blob));
    const blobSha = ((await blob.json()) as { sha?: string })?.sha;
    if (!blobSha) throw new Error('GitHub write blob returned no sha');

    const tree = await makeRequest(`${repoBase}/git/trees`, {
      method: 'POST',
      timeout: SYNC_TIMEOUT_MS,
      headers: jsonHeaders,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [{ path: treePath, mode: '100644', type: 'blob', sha: blobSha }],
      }),
    });
    if (tree.status !== 201) throw new Error(await githubError('write tree', tree));
    const newTreeSha = ((await tree.json()) as { sha?: string })?.sha;
    if (!newTreeSha) throw new Error('GitHub write tree returned no sha');

    const commit = await makeRequest(`${repoBase}/git/commits`, {
      method: 'POST',
      timeout: SYNC_TIMEOUT_MS,
      headers: jsonHeaders,
      body: JSON.stringify({
        message,
        tree: newTreeSha,
        parents: [baseCommitSha],
      }),
    });
    if (commit.status !== 201) {
      throw new Error(await githubError('write commit', commit));
    }
    const newCommitSha = ((await commit.json()) as { sha?: string })?.sha;
    if (!newCommitSha) throw new Error('GitHub write commit returned no sha');

    const update = await makeRequest(`${repoBase}/git/refs/${branchRef}`, {
      method: 'PATCH',
      timeout: SYNC_TIMEOUT_MS,
      headers: jsonHeaders,
      body: JSON.stringify({ sha: newCommitSha }),
    });
    if (update.status !== 200) {
      throw new Error(await githubError('update ref', update));
    }

    logger.info(
      `Screener: synced ${records.length} entries to ${c.owner}/${c.repo}/${treePath}`
    );
    return `synced ${records.length} entries`;
  }
}

async function githubError(
  op: string,
  res: { status: number; json: () => Promise<unknown> }
): Promise<string> {
  let detail = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { message?: string };
    if (j?.message) detail += `: ${j.message}`;
  } catch {
    // body wasn't JSON; the status code is enough
  }
  return `GitHub ${op} failed (${detail})`;
}

export const ScreenerGitHubSyncService = new ScreenerGitHubSyncServiceImpl();
