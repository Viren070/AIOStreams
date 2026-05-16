import { Router, Request, Response } from 'express';
import { createLogger, decryptString } from '@aiostreams/core';
import {
  type CleanRedirectPayload,
  isValidHttpUrl,
  sanitizeFilename,
} from '../../utils/cleanRedirect.js';

const router: Router = Router();
const logger = createLogger('stream-gate');

type StreamGateParams = {
  data: string;
  filename: string;
};

router.get(
  '/:data/:filename',
  (req: Request<StreamGateParams>, res: Response) => {
    const { data, filename } = req.params;

    const decrypted = decryptString(data);

    if (!decrypted.success || !decrypted.data) {
      logger.warn('Invalid stream-gate payload');
      res.status(400).send('Invalid request');
      return;
    }

    let payload: CleanRedirectPayload;

    try {
      payload = JSON.parse(decrypted.data) as CleanRedirectPayload;
    } catch {
      res.status(400).send('Invalid payload');
      return;
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      !payload.url ||
      !isValidHttpUrl(payload.url)
    ) {
      res.status(400).send('Invalid stream URL');
      return;
    }

    const safeFilename = sanitizeFilename(filename);
    const redirectCode = payload.redirectCode ?? 307;

    if (![302, 307, 308].includes(redirectCode)) {
      res.status(400).send('Invalid redirect code');
      return;
    }

    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Clean-Filename', safeFilename);

    res.redirect(redirectCode, payload.url);
  }
);

export default router;
