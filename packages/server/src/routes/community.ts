import { gzipSync } from 'node:zlib';
import { Router } from 'express';
import {
  config as appConfig,
  CommunityRepository,
  CommunityService,
} from '@aiostreams/core';

const router: Router = Router();

const BODY_MEMO_TTL_MS = 60_000;

interface MemoisedExport {
  revision: string;
  body: Buffer;
  gzipped: Buffer;
  at: number;
}

let memo: MemoisedExport | undefined;

/**
 * Opt-in public export so other instances can mirror this one's approved
 * community items. Disabled requests fall through to the 404 handler.
 */
router.get('/export.json', async (req, res, next) => {
  try {
    if (!appConfig.community.publicExport) {
      next();
      return;
    }
    const revision = await CommunityRepository.getExportRevision();
    if (
      !memo ||
      memo.revision !== revision ||
      Date.now() - memo.at > BODY_MEMO_TTL_MS
    ) {
      const body = Buffer.from(
        JSON.stringify(await CommunityService.exportItems()),
        'utf8'
      );
      memo = { revision, body, gzipped: gzipSync(body), at: Date.now() };
    }

    const etag = `"community:${revision}"`;
    res.vary('Accept-Encoding');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const acceptsGzip = /\bgzip\b/.test(
      String(req.headers['accept-encoding'] ?? '')
    );
    if (acceptsGzip) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.status(200).send(memo.gzipped);
    }
    return res.status(200).send(memo.body);
  } catch (err) {
    next(err);
  }
});

export default router;
