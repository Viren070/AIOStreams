import { Router, Request, Response } from 'express';
import path from 'path';
const router: Router = Router();
import { staticRateLimiter } from '../../middlewares/ratelimit.js';
import { frontendRoot } from '../../app.js';

export default router;

router.get('/', staticRateLimiter, (req: Request, res: Response) => {
  res.sendFile(path.join(frontendRoot, 'index.html'));
});
