import { NextFunction, Request, Response, Router } from 'express';
import { pipeline } from 'node:stream/promises';
import {
  DEEPBRID_FINDER_USER_AGENT,
  DeepbridUsenetAddon,
  decodeDeepbridPlaybackToken,
  decryptString,
  makeRequest,
  isDeepbridHost,
  validateDeepbridDownloadUrl,
} from '@aiostreams/core';

const router: Router = Router();

function config(encoded: string): unknown {
  const decrypted = decryptString(encoded);
  if (!decrypted.success || !decrypted.data) {
    throw new Error('Invalid encrypted Deepbrid Usenet configuration.');
  }
  return JSON.parse(decrypted.data);
}

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<{ encodedConfig: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(
        new DeepbridUsenetAddon(
          config(req.params.encodedConfig) as any,
          req.userIp
        ).getManifest()
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (
    req: Request<{ encodedConfig: string; type: string; id: string }>,
    res: Response,
    next: NextFunction
  ) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once('aborted', abort);
    res.once('close', abort);
    try {
      const addon = new DeepbridUsenetAddon(
        config(req.params.encodedConfig) as any,
        req.userIp
      );
      res.set('Cache-Control', 'private, no-store');
      res.json({
        streams: await addon.getStreams(
          req.params.type,
          req.params.id,
          controller.signal
        ),
      });
    } catch (error) {
      next(error);
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', abort);
    }
  }
);

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const;

router.get(
  '/play/:token{/:filename}',
  async (
    req: Request<{ token: string; filename?: string }>,
    res: Response,
    next: NextFunction
  ) => {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.once('close', onClose);
    try {
      const payload = decodeDeepbridPlaybackToken(req.params.token);
      const target = validateDeepbridDownloadUrl(payload.url);
      if (!isDeepbridHost(target.hostname)) {
        throw new Error(
          'Deepbrid authenticated playback proxy rejected an external host.'
        );
      }
      const headers: Record<string, string> = {
        Accept: '*/*',
        Authorization: `Bearer ${payload.apiKey}`,
        'User-Agent': DEEPBRID_FINDER_USER_AGENT,
      };
      if (typeof req.headers.range === 'string')
        headers.Range = req.headers.range;
      if (typeof req.headers['if-none-match'] === 'string')
        headers['If-None-Match'] = req.headers['if-none-match'];
      if (typeof req.headers['if-modified-since'] === 'string')
        headers['If-Modified-Since'] = req.headers['if-modified-since'];

      const upstream = await makeRequest(target.toString(), {
        timeout: 120_000,
        signal: controller.signal,
        headers,
        rawOptions: { redirect: 'manual' },
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get('location');
        await upstream.body?.cancel().catch(() => {});
        if (!location) {
          res.status(502).end();
          return;
        }
        const redirected = validateDeepbridDownloadUrl(
          new URL(location, target).toString()
        );
        if (isDeepbridHost(redirected.hostname)) {
          res.status(502).end();
          return;
        }
        res.redirect(302, redirected.toString());
        return;
      }
      if (!upstream.ok && upstream.status !== 304) {
        await upstream.body?.cancel().catch(() => {});
        res.status(upstream.status || 502).end();
        return;
      }
      res.status(upstream.status);
      res.set('Cache-Control', 'private, no-store');
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      if (!res.getHeader('Accept-Ranges'))
        res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(payload.filename)}"`
      );
      if (!upstream.body || upstream.status === 304) {
        res.end();
        return;
      }
      await pipeline(upstream.body, res);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      next(error);
    } finally {
      res.removeListener('close', onClose);
    }
  }
);

export default router;
