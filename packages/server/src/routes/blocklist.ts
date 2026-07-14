import { timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Router } from 'express';
import {
  config as appConfig,
  ReleaseBlocklistRepository,
  toNativeNdjson,
  toWardenNdjson,
  LOCAL_SOURCE_ID,
} from '@aiostreams/core';

const router: Router = Router();

const BODY_MEMO_TTL_MS = 60_000;

interface MemoisedExport {
  revision: string;
  body: Buffer;
  gzipped: Buffer;
  at: number;
}

const memo = new Map<string, MemoisedExport>();

function passwordMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Opt-in public export so other instances can subscribe to this one's list.
 * Disabled, missing-key and wrong-key requests all get the same 404 so the
 * endpoint does not advertise its existence.
 */
router.get('/export', async (req, res, next) => {
  try {
    const settings = appConfig.releaseBlocklist;
    if (!settings.publicExport) {
      next();
      return;
    }
    if (settings.publicExportPassword) {
      const key = typeof req.query.key === 'string' ? req.query.key : '';
      if (!key || !passwordMatches(key, settings.publicExportPassword)) {
        next();
        return;
      }
    }

    const format = req.query.format === 'warden' ? 'warden' : 'native';
    const requestedScope = req.query.scope === 'all' ? 'all' : 'local';
    const scope =
      settings.publicExportScope === 'all' ? requestedScope : 'local';

    const revision = await ReleaseBlocklistRepository.getExportRevision(scope);
    const memoKey = `${format}:${scope}`;
    let entry = memo.get(memoKey);
    if (
      !entry ||
      entry.revision !== revision ||
      Date.now() - entry.at > BODY_MEMO_TTL_MS
    ) {
      const records = await ReleaseBlocklistRepository.getEntries(
        scope === 'local' ? [LOCAL_SOURCE_ID] : undefined,
        scope === 'all'
      );
      const body = Buffer.from(
        format === 'warden' ? toWardenNdjson(records) : toNativeNdjson(records),
        'utf8'
      );
      entry = {
        revision,
        body,
        gzipped: gzipSync(body),
        at: Date.now(),
      };
      memo.set(memoKey, entry);
    }

    const etag = `"${format}:${scope}:${revision}"`;
    res.vary('Accept-Encoding');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    const acceptsGzip = /\bgzip\b/.test(
      String(req.headers['accept-encoding'] ?? '')
    );
    if (acceptsGzip) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.status(200).send(entry.gzipped);
    }
    return res.status(200).send(entry.body);
  } catch (err) {
    next(err);
  }
});

export default router;
