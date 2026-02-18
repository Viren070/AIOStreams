import { Router, Request, Response, NextFunction } from 'express';
import {
  LibraryAddon,
  fromUrlSafeBase64,
  preWarmLibraryCaches,
  refreshLibraryCacheForService,
  decryptString,
  BuiltinServiceId,
  constants,
  Cache,
} from '@aiostreams/core';
import { createLogger } from '@aiostreams/core';
import { StaticFiles } from '../../app.js';
const router: Router = Router();

const logger = createLogger('server');

// Rate limit: track last refresh time per service+credential combo
const lastRefreshMap = Cache.getInstance<string, number>(
  'library-refresh-rate-limit',
  1000
);
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

router.get(
  '/:encodedConfig/manifest.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig } = req.params;
    try {
      const config = encodedConfig
        ? JSON.parse(fromUrlSafeBase64(encodedConfig))
        : undefined;
      const addon = new LibraryAddon(config, req.userIp);
      const manifest = addon.getManifest();
      res.json(manifest);

      // Pre-warm library caches in the background after responding
      if (config?.services) {
        preWarmLibraryCaches(config.services, req.userIp, config.sources);
      }
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id, extras } = req.params;

    try {
      const addon = new LibraryAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      );
      const catalog = await addon.getCatalog(type, id, extras);
      res.json({
        metas: catalog,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;

    try {
      const addon = new LibraryAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      );
      const meta = await addon.getMeta(type, id);
      res.json({
        meta: meta,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;

    try {
      const addon = new LibraryAddon(
        encodedConfig
          ? JSON.parse(fromUrlSafeBase64(encodedConfig))
          : undefined,
        req.userIp
      );
      const streams = await addon.getStreams(type, id);
      res.json({
        streams: streams,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/refresh/:serviceId/:encryptedCredential',
  async (req: Request, res: Response, next: NextFunction) => {
    const { serviceId, encryptedCredential } = req.params;

    try {
      const decrypted = decryptString(decodeURIComponent(encryptedCredential));
      if (!decrypted.data) {
        return res.redirect(307, `/static/${StaticFiles.UNAUTHORIZED}`);
      }

      const parsed = JSON.parse(decrypted.data);
      const svcId = parsed.id as BuiltinServiceId;
      const credential = parsed.credential as string;
      const sources = parsed.sources as ('torrent' | 'nzb')[] | undefined;

      if (
        svcId !== serviceId ||
        !constants.BUILTIN_SUPPORTED_SERVICES.includes(svcId as any)
      ) {
        return res.redirect(307, `/static/${StaticFiles.UNAUTHORIZED}`);
      }

      // Rate limit: max once per 5 minutes per service+credential
      const rateKey = `${svcId}:${credential}`;
      const lastRefresh = await lastRefreshMap.get(rateKey);
      const now = Date.now();
      if (lastRefresh && now - lastRefresh < REFRESH_COOLDOWN_MS) {
        const timeElapsed = Math.floor((now - lastRefresh) / 1000);
        const remaining = Math.ceil(
          (REFRESH_COOLDOWN_MS - timeElapsed * 1000) / 1000
        );
        logger.info(
          `Refresh rate limited for ${svcId}, ${remaining}s remaining`
        );
        if (timeElapsed < 30) {
          return res.redirect(307, `/static/${StaticFiles.OK}`);
        }
        return res.redirect(307, `/static/${StaticFiles.TOO_MANY_REQUESTS}`);
      }

      await lastRefreshMap.set(rateKey, now, REFRESH_COOLDOWN_MS);
      logger.info(`Refreshing library cache for ${svcId} via stream action`);

      // Fire refresh in background, redirect immediately
      refreshLibraryCacheForService(
        svcId,
        credential,
        req.userIp,
        sources
      ).catch((err) =>
        logger.error(`Background refresh failed for ${svcId}`, {
          error: err?.message,
        })
      );

      return res.redirect(307, `/static/${StaticFiles.OK}`);
    } catch (error) {
      logger.error('Refresh endpoint error', { error });
      return res.redirect(307, `/static/${StaticFiles.INTERNAL_SERVER_ERROR}`);
    }
  }
);

export default router;
