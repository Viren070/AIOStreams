import { z } from 'zod';
import { githubRequest } from '../../../utils/github.js';
import type {
  PublishFile,
  PublishOutcome,
  PublishProvider,
} from '../provider.js';

export interface GithubGistConfig {
  token: string;
  gistId?: string;
  createPublic?: boolean;
}

const GistIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{16,64}$/i, 'not a gist id');

export const GithubGistConfigSchema = z.object({
  token: z.string().trim().min(1).max(400),
  gistId: GistIdSchema.or(z.literal('')).optional(),
  createPublic: z.boolean().optional(),
});

export const GithubGistConfigPatchSchema = z.object({
  token: z.string().trim().max(400).optional(),
  gistId: GistIdSchema.or(z.literal('')).optional(),
  createPublic: z.boolean().optional(),
});

interface GistResponse {
  id?: string;
  owner?: { login?: string };
}

const MAX_REQUEST_BYTES = 38 * 1024 * 1024;

const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Greedily pack files into requests that each stay under the cap. A file
 * larger than the cap cannot be split and gets a request of its own; the
 * publisher rejects those up front via `maxBytesPerFile`.
 */
function batchByBytes(files: PublishFile[], maxBytes: number): PublishFile[][] {
  const batches: PublishFile[][] = [];
  let batch: PublishFile[] = [];
  let bytes = 0;
  for (const file of files) {
    if (batch.length > 0 && bytes + file.content.length > maxBytes) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(file);
    bytes += file.content.length;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function normalize(config: GithubGistConfig): GithubGistConfig {
  return {
    token: config.token,
    ...(config.gistId ? { gistId: config.gistId } : {}),
    ...(config.createPublic !== undefined
      ? { createPublic: config.createPublic }
      : {}),
  };
}

export const githubGistProvider: PublishProvider<GithubGistConfig> = {
  id: 'github-gist',
  label: 'GitHub Gist',
  capabilities: {
    multiFile: true,
    // The gist API takes file content as a JSON string: text only.
    binary: false,
    // A single file cannot be split across requests, so it must fit in one.
    maxBytesPerFile: MAX_REQUEST_BYTES,
    maxBytesPerRequest: MAX_REQUEST_BYTES,
  },
  fields: [
    {
      key: 'token',
      label: 'GitHub token',
      type: 'password',
      required: true,
      secret: true,
      editPlaceholder: '(unchanged)',
      help: 'Fine-grained tokens are recommended; the classic gist scope grants write access to all your gists.',
    },
    {
      key: 'gistId',
      label: 'Gist ID',
      type: 'text',
      help: 'Leave blank to create a new gist on the first push.',
      editHelp: 'Clear to create a fresh gist on the next push.',
    },
    {
      key: 'createPublic',
      label: 'Create as public gist',
      type: 'switch',
      default: false,
      help: "Secret gists are still readable by anyone with the URL, they just aren't listed.",
    },
  ],
  configSchema: GithubGistConfigSchema as z.ZodType<GithubGistConfig>,
  configPatchSchema: GithubGistConfigPatchSchema as z.ZodType<
    Partial<GithubGistConfig>
  >,

  async validateConfig(config) {
    const normalized = normalize(config);
    if (normalized.gistId) {
      await githubRequest(`/gists/${normalized.gistId}`, {
        token: normalized.token,
      });
    }
    return normalized;
  },

  async publish(config, files: PublishFile[]): Promise<PublishOutcome> {
    let gistId = config.gistId;
    let owner: string | undefined;

    for (const batch of batchByBytes(files, MAX_REQUEST_BYTES)) {
      const fileMap: Record<string, { content: string }> = {};
      for (const file of batch) {
        fileMap[file.filename] = { content: file.content.toString('utf8') };
      }

      let response: GistResponse;
      if (!gistId) {
        const created = await githubRequest<GistResponse>('/gists', {
          method: 'POST',
          token: config.token,
          timeoutMs: UPLOAD_TIMEOUT_MS,
          body: {
            description: 'AIOStreams release blocklist',
            public: config.createPublic ?? false,
            files: fileMap,
          },
        });
        response = created.data;
        if (!response?.id) throw new Error('gist creation returned no id');
        gistId = response.id;
      } else {
        const updated = await githubRequest<GistResponse>(`/gists/${gistId}`, {
          method: 'PATCH',
          token: config.token,
          timeoutMs: UPLOAD_TIMEOUT_MS,
          body: { files: fileMap },
        });
        response = updated.data;
      }
      owner = response?.owner?.login ?? owner;
    }

    // The response's files[].raw_url is pinned to this revision; the
    // mutable follow-HEAD URL has to be constructed from the owner login.
    const urls: Record<string, string> = {};
    if (owner && gistId) {
      for (const file of files) {
        urls[file.filename] =
          `https://gist.githubusercontent.com/${owner}/${gistId}/raw/${encodeURIComponent(file.filename)}`;
      }
    }
    return {
      urls,
      ...(!config.gistId && gistId ? { configPatch: { gistId } } : {}),
    };
  },

  summarize(config) {
    return {
      gistId: config.gistId ?? null,
      createPublic: !!config.createPublic,
    };
  },

  hasCredential(config) {
    return typeof config.token === 'string' && config.token.length > 0;
  },
};
