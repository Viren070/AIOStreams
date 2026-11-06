import { Router, Request, Response, NextFunction } from 'express';
import { fromUrlSafeBase64, XtreamAddon } from '@aiostreams/core';
import { rawExtras } from '../../utils/extras.js';

const router: Router = Router();

interface Params {
  encodedConfig: string;
  type: string;
  id: string;
}

const addonOf = (encodedConfig: string) =>
  new XtreamAddon(JSON.parse(fromUrlSafeBase64(encodedConfig)));

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<Pick<Params, 'encodedConfig'>>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      res.json(await addonOf(req.params.encodedConfig).getManifest());
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (
    req: Request<Params & { extras?: string }>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json(
        await addonOf(encodedConfig).getCatalog(type, id, rawExtras(req))
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json({ meta: await addonOf(encodedConfig).getMeta(type, id) });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json({
        streams: await addonOf(encodedConfig).getStreams(type, id),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
