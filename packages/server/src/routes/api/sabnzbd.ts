import { Request, Response, Router } from 'express';
import {
  config as appConfig,
  createLogger,
  validateCredentials,
  hasPermission,
  parseCredential,
  Permission,
  handleSabnzbdRequest,
  renderSabnzbdXml,
  type SabnzbdRequest,
} from '@aiostreams/core';
import { corsMiddleware } from '../../middlewares/cors.js';
import {
  nzbUpload,
  pickUploadedFile,
  isFileTooLargeError,
} from '../../middlewares/upload.js';
import { wantsXml, sendXmlOrJson } from '../../utils/xml-response.js';

const logger = createLogger('server:sabnzbd');
const router: Router = Router();

router.use(corsMiddleware);

/** File fields a SABnzbd `addfile` upload may use. */
const NZB_FIELDS = ['name', 'nzbfile'];

/** Flatten query + parsed form fields into single string values. */
function flatParams(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const merge = (src: Record<string, unknown> | undefined) => {
    for (const [key, value] of Object.entries(src ?? {})) {
      if (Array.isArray(value)) {
        if (typeof value[0] === 'string') out[key] = value[0];
      } else if (typeof value === 'string') {
        out[key] = value;
      }
    }
  };
  merge(req.query as Record<string, unknown>);
  merge(req.body as Record<string, unknown>);
  return out;
}

/** Send a SABnzbd payload as JSON or XML per the client's `output`/`o` choice. */
function send(
  res: Response,
  status: number,
  payload: unknown,
  xml: boolean
): void {
  sendXmlOrJson(res, status, payload, xml, renderSabnzbdXml);
}

// The protocol endpoint lives at `<base>/api`; the bare base is not part of the
// SABnzbd API, so send a human who opens it in a browser to the usenet library.
router.get('/', (_req, res) => {
  res.redirect('/dashboard/usenet/library');
});

/**
 * SABnzbd-compatible API. One handler for GET and POST at `<base>/api`;
 * `addfile` arrives as multipart, every other mode as query/form params. The
 * `apikey` is an `AIOSTREAMS_AUTH` `username:password` credential (the same one
 * the native usenet service authorises against); `version` and `auth` are
 * exempt, mirroring SABnzbd.
 */
router.all(
  '/api',
  (req, res, next) => {
    if (!appConfig.usenet.sabnzbdApiEnabled) {
      send(
        res,
        403,
        { status: false, error: 'SABnzbd API is disabled on this instance' },
        wantsXml(flatParams(req))
      );
      return;
    }
    next();
  },
  nzbUpload(NZB_FIELDS),
  async (req: Request, res: Response) => {
    const params = flatParams(req);
    const xml = wantsXml(params);
    const mode = params.mode ?? '';

    let owner = 'sabnzbd';
    if (mode !== 'version' && mode !== 'auth') {
      const apikey = params.apikey ?? '';
      if (!apikey) {
        send(res, 403, { status: false, error: 'API Key Required' }, xml);
        return;
      }
      const creds = parseCredential(apikey);
      if (!creds || !validateCredentials(creds.username, creds.password)) {
        send(res, 403, { status: false, error: 'API Key Incorrect' }, xml);
        return;
      }
      if (!hasPermission(creds.username, Permission.Sabnzbd)) {
        send(res, 403, { status: false, error: 'API Key Forbidden' }, xml);
        return;
      }
      owner = creds.username;
    }

    const upload = pickUploadedFile(req, NZB_FIELDS);
    const request: SabnzbdRequest = {
      mode,
      params,
      owner,
      apikey: params.apikey ?? '',
      host: req.hostname,
      port: String(appConfig.bootstrap.port),
      // The path this router is mounted at (e.g. `/api/v1/sabnzbd`) — the
      // SABnzbd `url_base` clients should be configured with.
      urlBase: req.baseUrl,
      upload: upload
        ? { xml: upload.buffer, filename: upload.originalname }
        : undefined,
    };

    try {
      const result = await handleSabnzbdRequest(request);
      send(res, result.httpStatus ?? 200, result.payload, xml);
    } catch (err) {
      logger.error({ mode, err }, 'sabnzbd handler threw');
      send(res, 500, { status: false, error: 'internal server error' }, xml);
    }
  }
);

// multer raises this when the uploaded NZB exceeds usenet.maxNzbSize.
router.use(
  (
    err: unknown,
    req: Request,
    res: Response,
    next: (err?: unknown) => void
  ) => {
    if (isFileTooLargeError(err)) {
      const xml = wantsXml(flatParams(req));
      const maxMb = Math.floor(appConfig.usenet.maxNzbSize / 1024 / 1024);
      send(
        res,
        413,
        { status: false, error: `NZB too large (max ${maxMb}MB)` },
        xml
      );
      return;
    }
    next(err);
  }
);

export default router;
