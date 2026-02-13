import { Router, Request, Response } from 'express';
import { createLogger, decryptString } from '@aiostreams/core';

const logger = createLogger('strm-gate');
const router: Router = Router();

interface StrmGatePayload {
  url: string;
  mode: 'always' | 'userAgent';
  userAgents: string[];
}

router.get('/:data/:filename', (req: Request, res: Response) => {
  try {
    const { data, filename } = req.params;

    // Decrypt the payload
    const decrypted = decryptString(data);
    if (!decrypted.success || !decrypted.data) {
      logger.error('Failed to decrypt STRM gate data');
      res.status(400).send('Invalid request');
      return;
    }

    let payload: StrmGatePayload;
    try {
      payload = JSON.parse(decrypted.data);
    } catch {
      logger.error('Failed to parse STRM gate payload');
      res.status(400).send('Invalid request');
      return;
    }

    if (!payload.url || !payload.mode) {
      logger.error('Missing required fields in STRM gate payload');
      res.status(400).send('Invalid request');
      return;
    }

    // Determine if we should serve a .strm file or redirect
    let serveStrm = false;

    if (payload.mode === 'always') {
      serveStrm = true;
    } else if (payload.mode === 'userAgent') {
      const clientUserAgent = (req.headers['user-agent'] || '').toLowerCase();
      const userAgents = payload.userAgents || ['Infuse'];
      serveStrm = userAgents.some((ua) =>
        clientUserAgent.includes(ua.toLowerCase())
      );
    }

    if (serveStrm) {
      // Serve the .strm file
      const strmFilename = filename.endsWith('.strm')
        ? filename
        : `${filename}.strm`;

      logger.info(`Serving STRM file: ${strmFilename}`);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${strmFilename}"`
      );
      res.status(200).send(payload.url);
    } else {
      // Redirect to the actual stream URL
      logger.debug('STRM gate: User-Agent did not match, redirecting');
      res.redirect(302, payload.url);
    }
  } catch (error) {
    logger.error(
      `STRM gate error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    res.status(500).send('Internal server error');
  }
});

export default router;
