import { Router } from 'express';
import {
  config as appConfig,
  quickConnectAuthorize,
  quickConnectBySecret,
  quickConnectInitiate,
} from '@aiostreams/core';
import { jf, jfOptional, qs } from './context.js';

const router: Router = Router({ mergeParams: true });

function toResult(entry: {
  secret: string;
  code: string;
  deviceId: string;
  deviceName: string;
  appName: string;
  appVersion: string;
  dateAdded: string;
  uuid?: string;
}) {
  return {
    Authenticated: !!entry.uuid,
    Secret: entry.secret,
    Code: entry.code,
    DeviceId: entry.deviceId,
    DeviceName: entry.deviceName,
    AppName: entry.appName,
    AppVersion: entry.appVersion,
    DateAdded: entry.dateAdded,
  };
}

router.all('/QuickConnect/Enabled', (_req, res) => {
  res.json(appConfig.jellyfin.enabled === true);
});

const initiate = jfOptional(async (req, res) => {
  const client = req.jfClient ?? {
    name: 'Unknown',
    device: 'Unknown',
    deviceId: 'unknown',
    version: '0',
  };
  res.json(toResult(await quickConnectInitiate(client)));
});
router.get('/QuickConnect/Initiate', initiate);
router.post('/QuickConnect/Initiate', initiate);

router.get(
  '/QuickConnect/Connect',
  jfOptional(async (req, res) => {
    const secret = qs(req, 'secret') ?? '';
    const entry = secret ? await quickConnectBySecret(secret) : undefined;
    if (!entry) {
      res.status(404).json({ Message: 'Unknown secret' });
      return;
    }
    res.json(toResult(entry));
  })
);

/*
 * Approval from a signed-in Jellyfin client, always as itself: it cannot hand a
 * device another persona. The SPA has its own route.
 */
router.post(
  '/QuickConnect/Authorize',
  jf(async (req, res, ctx) => {
    const code = qs(req, 'code') ?? '';
    const entry = code
      ? await quickConnectAuthorize(code, {
          uuid: ctx.uuid,
          encryptedPassword: ctx.encryptedPassword,
          persona: ctx.persona?.id,
        })
      : null;
    res.json(!!entry);
  })
);

export default router;
