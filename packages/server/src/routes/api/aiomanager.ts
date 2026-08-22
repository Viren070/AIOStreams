import { Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  Env,
  isUnsafeRemoteUrl,
  makeRequest,
} from '@aiostreams/core';
import { z } from 'zod';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('server');

const STATUS_TIMEOUT = 10000;
const REINSTALL_TIMEOUT = 15000;

const StatusQuerySchema = z.object({
  instanceUrl: z.string().url(),
});

const ReinstallSchema = z.object({
  instanceUrl: z.string().url(),
  apiKey: z.string().min(1),
  addonUrl: z.string().url(),
});

/**
 * A manager URL comes from the browser and is fetched by this server, so it
 * gets the same guard as any other user-supplied remote: http(s) only, and no
 * loopback, private, link-local or CGNAT target.
 *
 * It is also a base that endpoint paths are appended to, so a query or fragment
 * on it would move the request: `https://host/?x=1` + `/hydra/reinstall` asks
 * for `/` and carries the API key there. A path is fine — instances behind one
 * are supported — but anything after it is refused rather than trimmed, so a
 * mistyped URL is reported instead of silently meaning something else.
 */
function managerUrlOrNull(value: string): URL | null {
  if (isUnsafeRemoteUrl(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return parsed.search || parsed.hash ? null : parsed;
}

function parseUrlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * GET /status — report whether a manager instance serves the Hydra API.
 *
 * Instances predating Hydra answer the route with their SPA, so a string body
 * or a payload without capabilities means unsupported rather than broken.
 */
router.get('/status', async (req, res, next) => {
  const parsed = StatusQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'instanceUrl must be a valid URL'
      )
    );
    return;
  }

  const instance = managerUrlOrNull(parsed.data.instanceUrl);
  if (!instance) {
    next(
      new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'instanceUrl must be a public http(s) URL with no query or fragment'
      )
    );
    return;
  }

  const target = `${stripTrailingSlashes(instance.toString())}/hydra/status`;
  try {
    const response = await makeRequest(target, {
      timeout: STATUS_TIMEOUT,
      method: 'GET',
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    const capabilities = (body as { capabilities?: unknown } | null)
      ?.capabilities;
    if (!capabilities) {
      res
        .status(200)
        .json(createResponse({ success: true, data: { supported: false } }));
      return;
    }
    // supported goes last: the upstream body is spread in wholesale and must
    // not be able to set the field this route exists to report.
    res.status(200).json(
      createResponse({
        success: true,
        data: { ...(body as Record<string, unknown>), supported: true },
      })
    );
  } catch (error) {
    // An unreachable instance is indistinguishable from one without Hydra from
    // here, and both mean the same thing to the person choosing an instance.
    logger.debug(`AIOManager status probe failed for ${instance.host}`);
    res
      .status(200)
      .json(createResponse({ success: true, data: { supported: false } }));
  }
});

/**
 * POST /reinstall — relay a sync to the user's manager instance.
 *
 * The browser never holds a connection to the manager, so the API key travels
 * to this addon and no further.
 */
router.post('/reinstall', async (req, res, next) => {
  const parsed = ReinstallSchema.safeParse(req.body);
  if (!parsed.success) {
    next(
      new APIError(
        constants.ErrorCode.MISSING_REQUIRED_FIELDS,
        undefined,
        'instanceUrl, apiKey and addonUrl are required, and both URLs must be valid'
      )
    );
    return;
  }

  const { apiKey, addonUrl } = parsed.data;
  const instance = managerUrlOrNull(parsed.data.instanceUrl);
  if (!instance) {
    next(
      new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'instanceUrl must be a public http(s) URL with no query or fragment'
      )
    );
    return;
  }

  // Only manifests this addon serves may be relayed. Without this the endpoint
  // would install any addon into any manager the caller holds a key for.
  const addon = parseUrlOrNull(addonUrl);
  const self = parseUrlOrNull(Env.BASE_URL);
  if (!addon || !self || addon.origin !== self.origin) {
    next(
      new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'addonUrl must be a manifest URL served by this instance'
      )
    );
    return;
  }

  const target = `${stripTrailingSlashes(instance.toString())}/hydra/reinstall`;
  try {
    const response = await makeRequest(target, {
      timeout: REINSTALL_TIMEOUT,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ addonUrl }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const detail =
        (body as { error?: string } | null)?.error ??
        `AIOManager refused the sync (${response.status})`;
      next(new APIError(constants.ErrorCode.BAD_REQUEST, undefined, detail));
      return;
    }

    if (body === null) {
      // A 2xx that is not JSON is the SPA catch-all, so this release has no
      // Hydra API and the sync was not carried out. Checked after the status,
      // because a 5xx error page is also unparseable and means something else.
      next(
        new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'This AIOManager instance does not serve the Hydra API yet, so nothing was synced. It needs a newer AIOManager release.'
        )
      );
      return;
    }

    res.status(200).json(
      createResponse({
        success: true,
        detail: 'Addon synced to AIOManager',
        data: body as Record<string, unknown>,
      })
    );
  } catch (error) {
    logger.error(error);
    next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
  }
});

export default router;
