import { APIError, ErrorCode } from '../../utils/constants.js';
import { createLogger } from '../../logging/logger.js';
import {
  assertReachableUrl,
  isUnusable,
  normaliseInstanceUrl,
  requestJson,
  unexpectedResponse,
} from '../http.js';
import { addonUrlKey } from '../matching.js';
import type {
  ConnectResult,
  LinkedAccountPlatform,
  ProbeResult,
  PushResult,
  ResolvedLinkedAccount,
} from '../types.js';

const logger = createLogger('linked-accounts');

/**
 * `/hydra/reinstall` is capped at 10 requests per minute, so pushes are
 * serialised and the URL count per push is bounded well under it.
 */
const REINSTALL_SPACING_MS = 1200;
const MAX_URLS_PER_PUSH = 8;

interface HydraStatus {
  name?: string;
  version?: string;
  platformVersion?: string;
  capabilities?: string[];
}

const NO_HYDRA =
  'This AIOManager instance does not serve the Hydra API. It needs a newer AIOManager release.';

// A 200 that is not JSON is the SPA catch-all, which is what an AIOManager
// without Hydra serves. Anything else means we never reached AIOManager at all.
const STALE_HINT =
  'This AIOManager may be too old to serve the Hydra API, or the URL may not point at AIOManager.';

const REACH_HINT =
  'Check the URL, and that this server can reach it without a login.';

function statusUrl(instanceUrl: string): string {
  return `${instanceUrl}/hydra/status`;
}

async function fetchStatus(instanceUrl: string): Promise<ProbeResult> {
  const response = await requestJson<HydraStatus>(statusUrl(instanceUrl));

  if (isUnusable(response)) {
    const reachedSomething = !response.redirected && response.status < 400;
    return {
      ok: false,
      message: `${unexpectedResponse('/hydra/status', response)} ${
        reachedSomething ? STALE_HINT : REACH_HINT
      }`,
    };
  }
  if (!response.json?.capabilities) {
    return { ok: false, message: NO_HYDRA };
  }
  return {
    ok: true,
    version: response.json.platformVersion ?? response.json.version,
  };
}

export const aiomanagerPlatform: LinkedAccountPlatform = {
  id: 'aiomanager',
  name: 'AIOManager',
  kind: 'manager',
  logo: 'https://raw.githubusercontent.com/Sonicx161/AIOManager/main/public/logo.png',
  description:
    'Sends this addon to your AIOManager account, which passes it on to every platform you have connected there.',
  commonFields: [
    {
      key: 'instanceUrl',
      label: 'Instance URL',
      type: 'url',
      placeholder: 'https://aiomanager.example.com',
      help: 'The address you open AIOManager at.',
    },
  ],
  probeOn: 'instanceUrl',
  authMethods: [
    {
      id: 'apiKey',
      label: 'Account API key',
      fields: [
        {
          key: 'apiKey',
          label: 'Account API key',
          type: 'password',
          help: 'In AIOManager, open your account and copy the key from the API Key tab.',
        },
      ],
    },
  ],

  async probe(input): Promise<ProbeResult> {
    const instanceUrl = normaliseInstanceUrl(String(input.instanceUrl ?? ''));
    if (!instanceUrl) {
      return { ok: false, message: 'Enter your AIOManager instance URL.' };
    }
    try {
      await assertReachableUrl(instanceUrl);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof APIError ? error.message : 'Invalid URL.',
      };
    }
    try {
      return await fetchStatus(instanceUrl);
    } catch {
      return {
        ok: false,
        message: 'Could not reach that AIOManager instance.',
      };
    }
  },

  async connect(input): Promise<ConnectResult> {
    const instanceUrl = normaliseInstanceUrl(String(input.instanceUrl ?? ''));
    const apiKey = String(input.apiKey ?? '').trim();
    if (!instanceUrl || !apiKey) {
      throw new APIError(
        ErrorCode.MISSING_REQUIRED_FIELDS,
        400,
        'An instance URL and an account API key are both required.'
      );
    }
    await assertReachableUrl(instanceUrl);

    const status = await fetchStatus(instanceUrl);
    if (!status.ok) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        status.message ?? NO_HYDRA
      );
    }

    await register(instanceUrl, apiKey);

    const host = new URL(instanceUrl).host;
    return {
      credentials: { apiKey },
      config: { instanceUrl },
      identity: host,
      label: `AIOManager (${host})`,
    };
  },

  async push(account, manifests): Promise<PushResult> {
    const instanceUrl = account.config.instanceUrl;
    if (!instanceUrl) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        'This AIOManager link is missing its instance URL. Unlink it and link it again.'
      );
    }
    const apiKey = account.credentials.apiKey;
    const urls = manifests.map((entry) => entry.url);
    assertDistinctInAioManager(urls);

    if (urls.length > MAX_URLS_PER_PUSH) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        `AIOManager accepts at most ${MAX_URLS_PER_PUSH} addons per push. Reduce the number of variants you are syncing.`
      );
    }

    const outcomes: PushResult['outcomes'] = [];
    for (const [index, url] of urls.entries()) {
      if (index > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, REINSTALL_SPACING_MS)
        );
      }
      outcomes.push({
        url,
        status: await reinstall(instanceUrl, apiKey, url),
      });
    }

    // Refreshes the "last seen" stamp on our card in their Connections list.
    await register(instanceUrl, apiKey).catch(() => undefined);

    return { outcomes };
  },
};

async function register(instanceUrl: string, apiKey: string): Promise<void> {
  const response = await requestJson(`${instanceUrl}/hydra/register`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: { name: 'AIOStreams' },
  });
  const { status, json } = response;
  if (response.redirected) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      502,
      unexpectedResponse('/hydra/register', response)
    );
  }
  if (status === 401) {
    throw new APIError(
      ErrorCode.UNAUTHORIZED,
      401,
      'AIOManager rejected that API key. Copy it again from the API Key tab of your account.'
    );
  }
  if (status >= 400 || json === null) {
    throw new APIError(ErrorCode.BAD_REQUEST, 502, NO_HYDRA);
  }
}

async function reinstall(
  instanceUrl: string,
  apiKey: string,
  addonUrl: string
): Promise<'refreshed'> {
  const response = await requestJson<{ addons?: unknown[] }>(
    `${instanceUrl}/hydra/reinstall`,
    {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: { addonUrl },
    }
  );

  const { status, json } = response;
  if (response.redirected) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      502,
      unexpectedResponse('/hydra/reinstall', response)
    );
  }

  if (status === 401) {
    throw new APIError(
      ErrorCode.UNAUTHORIZED,
      401,
      'AIOManager rejected that API key. It may have been rotated.'
    );
  }
  if (status === 429) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      429,
      'AIOManager is rate limiting this account. Wait a minute and try again.'
    );
  }
  if (json === null) {
    throw new APIError(ErrorCode.BAD_REQUEST, 502, NO_HYDRA);
  }
  if (status >= 400) {
    const message =
      typeof (json as any)?.message === 'string'
        ? (json as any).message
        : 'AIOManager refused the update.';
    throw new APIError(ErrorCode.BAD_REQUEST, status, message);
  }

  logger.info(
    { instance: new URL(instanceUrl).host },
    'pushed manifest to aiomanager'
  );
  // Hydra answers with the whole collection either way, so a fresh install
  // and an in-place refresh are not distinguishable from the response.
  return 'refreshed';
}

/**
 * AIOManager identifies an addon by its URL with the query string stripped, so
 * variants selected with `?v=` all collapse onto one addon and overwrite each
 * other. The path selector (`/v/`) stays distinct.
 */
function assertDistinctInAioManager(urls: string[]): void {
  const seen = new Set<string>();
  for (const url of urls) {
    const key = addonUrlKey(url.replace(/\?.*$/, ''));
    if (seen.has(key)) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        'AIOManager ignores the query string when identifying an addon, so these variants would overwrite each other. Switch the variant selector location to "Path segment (/v/)" and try again.'
      );
    }
    seen.add(key);
  }
}
