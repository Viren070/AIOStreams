import { NextFunction, Request, Response, Router } from 'express';
import {
  config as appConfig,
  createLogger,
  validateCredentials,
  resolveWebdavNode,
  renderPropfind,
  webdavHref,
  mintUsenetLibraryToken,
  UsenetLibraryRepository,
  isBrowsableFile,
  type WebdavNode,
} from '@aiostreams/core';
import { serveUsenetStreamToken } from '../utils/serve-usenet.js';

const logger = createLogger('server:webdav');

const router: Router = Router();

const REALM = 'AIOStreams WebDAV';
const ALLOW = 'OPTIONS, GET, HEAD, PROPFIND, DELETE';
const XML_CONTENT_TYPE = 'application/xml; charset="utf-8"';

// Per-IP failed-login throttle (brute-force guard). A plain in-process Map with
// synchronous read+increment (no await in between) so concurrent bad attempts
// can't race past the limit the way an async get/set store would. Only failures
// are counted, so successful streaming never touches it.
const MAX_AUTH_FAILURES = 20;
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_MAX_IPS = 10000;
const authFailures = new Map<string, { count: number; resetAt: number }>();

function authFailureCount(ip: string): number {
  const e = authFailures.get(ip);
  if (!e || e.resetAt <= Date.now()) return 0;
  return e.count;
}

function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const e = authFailures.get(ip);
  if (e && e.resetAt > now) {
    e.count++;
    return;
  }
  if (authFailures.size >= AUTH_FAILURE_MAX_IPS) {
    for (const [k, v] of authFailures) if (v.resetAt <= now) authFailures.delete(k);
    // Still full of live entries (e.g. a distributed attack): evict the oldest
    // so the map stays hard-bounded rather than growing without limit.
    while (authFailures.size >= AUTH_FAILURE_MAX_IPS) {
      const oldest = authFailures.keys().next().value;
      if (oldest === undefined) break;
      authFailures.delete(oldest);
    }
  }
  authFailures.set(ip, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS });
}

/** Decode a request path into clean, decoded path segments below `/dav`. */
function pathSegments(reqPath: string): string[] {
  return reqPath
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/** Normalise a possibly-array header to a single lowercased string. */
function header(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : (value ?? '')).trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Validate HTTP Basic credentials against `AIOSTREAMS_AUTH`. Sends a `401` with
 * a `WWW-Authenticate` challenge and returns `null` on any failure (missing
 * header, malformed, or invalid). Returns the authenticated username on success.
 */
function authenticate(req: Request, res: Response): string | null {
  const auth = header(req.headers.authorization);
  if (!auth.toLowerCase().startsWith('basic ')) {
    logger.debug(
      { method: req.method, path: req.path, ip: req.userIp },
      'webdav request missing Basic credentials'
    );
    challenge(res);
    return null;
  }
  let decoded = '';
  try {
    decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    challenge(res);
    return null;
  }
  const idx = decoded.indexOf(':');
  const username = idx === -1 ? decoded : decoded.slice(0, idx);
  const password = idx === -1 ? '' : decoded.slice(idx + 1);
  if (!validateCredentials(username, password)) {
    // Don't log the decoded username: a header with no colon puts the whole
    // value (possibly a copied password/token) into it.
    logger.warn(
      { method: req.method, path: req.path, ip: req.userIp },
      'webdav authentication failed'
    );
    challenge(res);
    return null;
  }
  return username;
}

function challenge(res: Response): void {
  res
    .status(401)
    .setHeader('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  res.send('Unauthorized');
}

/**
 * Map a path to the library entry a DELETE removes. A release-folder (collection)
 * delete removes the whole entry; a single file only does so when it's the
 * release's sole browsable file, so deleting one file never silently takes out
 * its siblings.
 */
function deletableEntry(node: WebdavNode) {
  if (node.kind === 'collection' && node.entry) return node.entry;
  if (node.kind === 'file') {
    const browsable = node.entry.files.filter(isBrowsableFile);
    if (browsable.length <= 1) return node.entry;
  }
  return undefined;
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!appConfig.usenet.webdavEnabled) {
    logger.debug({ path: req.path }, 'webdav request while server disabled');
    res.status(404).send('WebDAV server is disabled');
    return;
  }

  // Throttle password guessing by counting only failed logins per IP, at auth
  // time (not request completion), so long-running Range streams never occupy a
  // slot and concurrent playback can't trip the limit.
  const ip = req.userIp || req.ip || 'unknown';
  if (authFailureCount(ip) >= MAX_AUTH_FAILURES) {
    logger.warn({ ip, path: req.path }, 'webdav auth attempts rate limited');
    res
      .status(429)
      .setHeader('Retry-After', String(Math.ceil(AUTH_FAILURE_WINDOW_MS / 1000)))
      .send('Too Many Requests');
    return;
  }

  const username = authenticate(req, res);
  if (!username) {
    recordAuthFailure(ip);
    return;
  }
  authFailures.delete(ip);

  const segments = pathSegments(req.path);
  const method = req.method.toUpperCase();
  // Per RFC 4918 an omitted Depth means infinity, so it falls into the same
  // finite-depth rejection below rather than silently returning one level.
  const depth = header(req.headers.depth).toLowerCase() || 'infinity';

  logger.debug(
    {
      method,
      path: req.path,
      segments,
      depth: method === 'PROPFIND' ? depth : undefined,
      range: req.headers.range ?? undefined,
      username,
      ip: req.userIp,
    },
    'webdav request'
  );

  try {
    switch (method) {
      case 'OPTIONS': {
        res
          .status(204)
          .setHeader('Allow', ALLOW)
          .setHeader('DAV', '1')
          .setHeader('MS-Author-Via', 'DAV')
          .end();
        return;
      }

      case 'PROPFIND': {
        if (depth !== '0' && depth !== '1') {
          // No recursive listing: reject finite-depth rather than return a
          // partial tree a recursive client would cache as complete (RFC 4918
          // §9.1).
          logger.debug(
            { path: req.path, depth, username },
            'webdav PROPFIND finite-depth rejected'
          );
          res
            .status(403)
            .setHeader('Content-Type', XML_CONTENT_TYPE)
            .send(
              '<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>'
            );
          return;
        }
        const resolved = await resolveWebdavNode(segments);
        if (!resolved) {
          logger.debug({ path: req.path, username }, 'webdav PROPFIND miss');
          res.status(404).send('Not Found');
          return;
        }
        const nodes: WebdavNode[] =
          depth === '0'
            ? [resolved.self]
            : [resolved.self, ...resolved.children];
        logger.debug(
          { path: req.path, kind: resolved.self.kind, count: nodes.length },
          'webdav PROPFIND'
        );
        res
          .status(207)
          .setHeader('Content-Type', XML_CONTENT_TYPE)
          .setHeader('DAV', '1')
          .send(renderPropfind(nodes));
        return;
      }

      case 'GET':
      case 'HEAD': {
        const resolved = await resolveWebdavNode(segments);
        if (!resolved) {
          logger.debug({ path: req.path, username }, 'webdav GET miss');
          res.status(404).send('Not Found');
          return;
        }
        const node = resolved.self;
        if (node.kind === 'collection') {
          const html = renderDirIndex(resolved.children);
          res
            .status(200)
            .setHeader('Content-Type', 'text/html; charset=utf-8')
            .setHeader('Content-Length', String(Buffer.byteLength(html)))
            .setHeader('Allow', ALLOW);
          // HEAD reports the same headers as GET but no body.
          if (method === 'HEAD') {
            res.end();
            return;
          }
          res.send(html);
          return;
        }
        const selector =
          node.file.path ??
          (node.file.index != null
            ? String(node.file.index)
            : (node.file.name ?? ''));
        const minted = await mintUsenetLibraryToken(
          node.entry.nzbHash,
          selector,
          { strict: true }
        );
        if (!minted) {
          logger.warn(
            { path: req.path, nzbHash: node.entry.nzbHash, selector, username },
            'webdav GET could not mint stream token (entry no longer streamable)'
          );
          res.status(410).send('Gone');
          return;
        }
        logger.debug(
          {
            path: req.path,
            nzbHash: node.entry.nzbHash,
            filename: minted.filename,
            username,
          },
          'webdav serving file'
        );
        await serveUsenetStreamToken(req, res, next, {
          token: minted.token,
          asAttachment: false,
        });
        return;
      }

      case 'DELETE': {
        const resolved = await resolveWebdavNode(segments);
        if (!resolved) {
          res.status(404).send('Not Found');
          return;
        }
        const entry = deletableEntry(resolved.self);
        if (!entry) {
          logger.debug(
            { path: req.path, username },
            'webdav DELETE rejected on virtual folder'
          );
          res
            .status(403)
            .send('Cannot delete this path (delete the release folder instead)');
          return;
        }
        await UsenetLibraryRepository.delete(entry.nzbHash);
        logger.info(
          { path: req.path, nzbHash: entry.nzbHash, name: entry.name, username },
          'webdav deleted library entry'
        );
        res.status(204).end();
        return;
      }

      // Anything not in ALLOW (PUT/MKCOL/MOVE/COPY/LOCK/PROPPATCH/…) is
      // unsupported on this virtual, streamed tree. One consistent response.
      default: {
        logger.debug(
          { method, path: req.path, username },
          'webdav method not allowed'
        );
        res.status(405).setHeader('Allow', ALLOW).send('Method Not Allowed');
        return;
      }
    }
  } catch (err) {
    logger.error(
      { err, method, path: req.path, username },
      'webdav request handler failed'
    );
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
});

/** Minimal HTML directory index for browser convenience (PROPFIND drives clients). */
function renderDirIndex(children: WebdavNode[]): string {
  const rows = children
    .map((c) => {
      const href = webdavHref(c);
      const label = escapeHtml(c.name) + (c.kind === 'collection' ? '/' : '');
      return `<li><a href="${escapeHtml(href)}">${label}</a></li>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>AIOStreams WebDAV</title></head><body><ul>\n${rows}\n</ul></body></html>`;
}

export default router;
