import { z } from 'zod';
import { makeRequest } from '../../utils/index.js';

export const DEEPBRID_API_BASE = 'https://www.deepbrid.com/api/v1';
export const DEEPBRID_FINDER_USER_AGENT =
  'Deepbrid/1.0 (ios) DBX/k9Q4mZ2xV7bN1pR8sT3wY6cH0jL5dF';

const ResultSchema = z.looseObject({
  token: z.coerce.string().min(1),
  title: z.string().optional(),
  name: z.string().optional(),
  category: z.coerce.string().optional(),
  category_name: z.coerce.string().optional(),
  categoryName: z.coerce.string().optional(),
  kind: z.coerce.string().optional(),
  size: z.coerce.number().nonnegative().catch(0),
  size_human: z.coerce.string().optional(),
  sizeHuman: z.coerce.string().optional(),
  date: z.coerce.string().optional(),
  created_at: z.coerce.string().optional(),
  sources: z.coerce.number().int().nonnegative().catch(0),
});

const FileSchema = z.looseObject({
  name: z.string().optional(),
  filename: z.string().optional(),
  link: z.url().optional(),
  url: z.url().optional(),
  size: z.coerce.number().nonnegative().catch(0),
  size_human: z.coerce.string().optional(),
  sizeHuman: z.coerce.string().optional(),
});

export interface DeepbridFinderResult {
  token: string;
  title: string;
  category: string;
  categoryName: string;
  kind: string;
  size: number;
  sizeHuman: string;
  date: string;
  sources: number;
}

export interface DeepbridFinderFile {
  name: string;
  link: string;
  size: number;
  sizeHuman: string;
}

export interface DeepbridFinderContent {
  title: string;
  files: DeepbridFinderFile[];
  hasPassword: boolean;
  password: string;
}

export class DeepbridApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'DeepbridApiError';
  }
}

export function isDeepbridHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'deepbrid.com' || host.endsWith('.deepbrid.com');
}

export function validateDeepbridDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new DeepbridApiError(
      'Deepbrid returned an unsafe download URL.',
      undefined,
      'unsafe-download-url'
    );
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url;
}

function looksLikeHtml(contentType: string, text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return (
    contentType.toLowerCase().includes('html') ||
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html')
  );
}

function apiMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'error_message', 'error_description']) {
    if (typeof record[key] === 'string' && record[key]) return record[key];
  }
  return fallback;
}

export class DeepbridFinderClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 20_000
  ) {
    if (!apiKey.trim())
      throw new DeepbridApiError('Deepbrid API key is required.');
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const response = await makeRequest(`${DEEPBRID_API_BASE}${path}`, {
      timeout: this.timeoutMs,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'User-Agent': DEEPBRID_FINDER_USER_AGENT,
      },
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    if (looksLikeHtml(contentType, text)) {
      throw new DeepbridApiError(
        "Deepbrid's edge rejected the API request.",
        response.status,
        'cloudflare-response'
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DeepbridApiError(
        'Deepbrid returned a non-JSON response.',
        response.status,
        'invalid-json'
      );
    }
    if (!response.ok) {
      throw new DeepbridApiError(
        apiMessage(parsed, `Deepbrid request failed (${response.status}).`),
        response.status,
        'http-error'
      );
    }
    if (parsed && typeof parsed === 'object') {
      const error = (parsed as Record<string, unknown>).error;
      const code = Number(error);
      if (Number.isFinite(code) && code !== 0) {
        throw new DeepbridApiError(
          apiMessage(parsed, 'Deepbrid reported that the request failed.'),
          undefined,
          `api_${code}`
        );
      }
      return parsed as Record<string, unknown>;
    }
    return {};
  }

  async search(
    query: string,
    options: { category?: string; offset?: number; limit?: number } = {}
  ): Promise<DeepbridFinderResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];
    const offset = Math.max(0, Math.floor(options.offset || 0));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 50)));
    const params = new URLSearchParams({
      q: trimmed,
      offset: String(offset),
      limit: String(limit),
    });
    if (options.category) params.set('category', options.category);
    const json = await this.getJson(`/usenet/finder/search?${params}`);
    const items = Array.isArray(json.items) ? json.items : [];
    return items.flatMap((value) => {
      const parsed = ResultSchema.safeParse(value);
      if (!parsed.success) return [];
      const item = parsed.data;
      const title = item.title || item.name || '';
      if (!title) return [];
      return [
        {
          token: item.token,
          title,
          category: item.category || '',
          categoryName: item.category_name || item.categoryName || '',
          kind: item.kind || '',
          size: item.size,
          sizeHuman: item.size_human || item.sizeHuman || '',
          date: item.date || item.created_at || '',
          sources: item.sources,
        },
      ];
    });
  }

  async getContent(
    token: string,
    archives: boolean
  ): Promise<DeepbridFinderContent> {
    if (!token.trim())
      throw new DeepbridApiError('Deepbrid content token is required.');
    const params = new URLSearchParams({
      token: token.trim(),
      archives: archives ? '1' : '0',
    });
    const json = await this.getJson(`/usenet/finder/content?${params}`);
    const values = Array.isArray(json.files) ? json.files : [];
    const files = values.flatMap((value) => {
      const parsed = FileSchema.safeParse(value);
      if (!parsed.success) return [];
      const file = parsed.data;
      const name = file.name || file.filename || '';
      const link = file.link || file.url || '';
      if (!name || !link) return [];
      try {
        return [
          {
            name,
            link: validateDeepbridDownloadUrl(link).toString(),
            size: file.size,
            sizeHuman: file.size_human || file.sizeHuman || '',
          },
        ];
      } catch {
        return [];
      }
    });
    const hasPassword =
      json.has_password === true ||
      json.has_password === 1 ||
      json.hasPassword === true;
    return {
      title: typeof json.title === 'string' ? json.title : '',
      files,
      hasPassword,
      password: typeof json.password === 'string' ? json.password : '',
    };
  }
}

export function isDeepbridArchiveName(name: string): boolean {
  return /\.(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|s\d{2}|part\d+\.rar|tar|gz|bz2)$/i.test(
    name
  );
}

export function isDeepbridVideoName(name: string): boolean {
  return /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i.test(name);
}
