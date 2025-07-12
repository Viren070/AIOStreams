import { Router } from 'express';
import path from 'path';
const router = Router();
import { staticRateLimiter } from '../../middlewares/ratelimit';
import { frontendRoot } from '../../app';

export default router;

router.get('/', staticRateLimiter, (req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.html'));
});
