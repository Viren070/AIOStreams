import { Router } from 'express';
import {
  extractAuth,
  PARTY_PROTOCOL,
  type PartyRelayInfo,
} from '@aiostreams/core';
import { jellyfinApiRateLimiter } from '../middlewares/ratelimit.js';
import { jellyfinCors } from '../routes/jellyfin/index.js';
import { userForToken } from '../routes/jellyfin/context.js';
import { listedParties } from './relay.js';
import { relayMode } from './mode.js';

const router: Router = Router();

router.use('/v1', jellyfinCors, jellyfinApiRateLimiter);

router.get('/v1', (_req, res) => {
  const info: PartyRelayInfo = { v: PARTY_PROTOCOL, relay: relayMode() };
  res.json(info);
});

router.get('/v1/parties', async (req, res) => {
  const { token } = extractAuth({
    header: (name) => req.get(name),
    query: req.query as Record<string, unknown>,
  });
  const user = token ? await userForToken(token).catch(() => null) : null;
  if (!user) {
    res.status(401).json({ error: 'Sign in to this server first' });
    return;
  }
  res.json({ parties: await listedParties(user) });
});

export default router;
