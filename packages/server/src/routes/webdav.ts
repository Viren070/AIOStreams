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
  WEBDAV_BASE,
  type WebdavNode,
} from '@aiostreams/core';
import { serveUsenetStreamToken } from '../utils/serve-usenet.js';

const logger = createLogger('server:webdav');

const router: Router = Router();

const REALM = 'AIOStreams WebDAV';
const ALLOW = 'OPTIONS, GET, HEAD, PROPFIND, DELETE, MOVE';
const XML_CONTENT_TYPE = 'application/xml; charset="utf-8"';

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
    logger.warn(
      { method: req.method, path: req.path, username, ip: req.userIp },
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

/** A concrete file/release path resolves to a deletable library entry. */
function deletableEntry(node: WebdavNode) {
  if (node.kind === 'file') return node.entry;
  if (node.kind === 'collection' && node.entry) return node.entry;
  return undefined;
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!appConfig.usenet.webdavEnabled) {
    logger.debug({ path: req.path }, 'webdav request while server disabled');
    res.status(404).send('WebDAV server is disabled');
    return;
  }

  const username = authenticate(req, res);
  if (!username) return;

  const segments = pathSegments(req.path);
  const method = req.method.toUpperCase();
  const depth = header(req.headers.depth) || 'infinity';

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
        if (depth !== '0' && depth !== '1') {
          logger.debug(
            { path: req.path, depth, children: resolved.children.length },
            'webdav PROPFIND depth-infinity capped to one level'
          );
        }
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
          res
            .status(200)
            .setHeader('Content-Type', 'text/html; charset=utf-8')
            .setHeader('Allow', ALLOW);
          res.send(method === 'HEAD' ? '' : renderDirIndex(resolved.children));
          return;
        }
        const selector =
          node.file.path ??
          (node.file.index != null
            ? String(node.file.index)
            : (node.file.name ?? ''));
        const minted = await mintUsenetLibraryToken(
          node.entry.nzbHash,
          selector
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
          res.status(403).send('Cannot delete this collection');
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

      case 'MOVE': {
        const destination = header(req.headers.destination);
        let destPath = '';
        try {
          destPath = new URL(
            destination,
            `${req.protocol}://${req.headers.host ?? 'localhost'}`
          ).pathname;
        } catch {
          destPath = destination;
        }
        // The tree is a virtual projection of the library; a rename within the
        // mount has no backing file to relocate, so acknowledge it as a no-op.
        // A move out of the mount cannot be honoured (the bytes are streamed on
        // demand, not stored).
        if (destPath.startsWith(`${WEBDAV_BASE}/`)) {
          logger.debug(
            { path: req.path, destination: destPath, username },
            'webdav MOVE within mount acknowledged (virtual tree, no-op)'
          );
          res.status(201).setHeader('Location', destPath).end();
          return;
        }
        logger.debug(
          { path: req.path, destination: destPath, username },
          'webdav MOVE out of mount rejected (streamed content cannot be relocated)'
        );
        res.status(502).send('Cannot move streamed content out of the mount');
        return;
      }

      case 'PUT':
      case 'MKCOL':
      case 'COPY':
      case 'LOCK':
      case 'UNLOCK':
      case 'PROPPATCH': {
        logger.debug(
          { method, path: req.path, username },
          'webdav write method rejected (server is read + delete/move only)'
        );
        res.status(403).setHeader('Allow', ALLOW).send('Forbidden');
        return;
      }

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
