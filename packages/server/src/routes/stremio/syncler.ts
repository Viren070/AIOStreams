import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  createLogger,
  StremioTransformer,
} from '@aiostreams/core';
import { stremioStreamRateLimiter } from '../../middlewares/ratelimit.js';
import { trackResource } from '../../middlewares/analytics.js';

const router: Router = Router();
const logger = createLogger('server');

router.use(stremioStreamRateLimiter);
router.use(trackResource('stream'));

interface StreamParams {
  type: string;
  id: string;
}

router.get(
  '/stream/:type/:id.json',
  async (
    req: Request<StreamParams>,
    res: Response,
    next: NextFunction
  ) => {
    if (!req.userData) {
      res.status(200).json(
        StremioTransformer.createDynamicError('stream', {
          errorDescription: 'Please configure the addon first',
        })
      );
      return;
    }

    try {
      const { type, id } = req.params;
      const aiostreams = await new AIOStreams(req.userData).initialise();
      const response = await aiostreams.getStreams(id, type);
      const streamContext = aiostreams.getStreamContext();

      if (!streamContext) {
        throw new Error('Stream context not available');
      }

      // We get the raw Stremio streams to have the final URLs
      const transformer = new StremioTransformer(req.userData);
      const stremioResponse = await transformer.transformStreams(
        response,
        streamContext.toFormatterContext(response.data.streams),
        { provideStreamData: false, disableAutoplay: false }
      );

      const streams = stremioResponse.streams || [];
      const resolvedStreams = response.data.streams || [];

      // Map to Syncler format
      const synclerStreams = streams.map((stream, index) => {
        const resolved = resolvedStreams[index] as import('@aiostreams/core').AIOStream;
        const badges: string[] = [];

        let filename = 'Unknown';
        let quality = 'Unknown';
        let size = 0;
        let host = 'Unknown';

        if (resolved && resolved.streamData) {
          const sd = resolved.streamData;
          
          if (sd.addon) badges.push(sd.addon);
          if (sd.library) badges.push('LIBRARY');
          if (sd.service && sd.service.cached) badges.push('CACHED');
          if (sd.service && !sd.service.cached) badges.push('UNCACHED');
          
          if (sd.parsedFile) {
            if (sd.parsedFile.resolution) quality = sd.parsedFile.resolution;
            if (sd.parsedFile.visualTags && sd.parsedFile.visualTags.includes('DV')) badges.push('DV');
            if (sd.parsedFile.visualTags && sd.parsedFile.visualTags.includes('HDR')) badges.push('HDR');
          }
          
          if (sd.size) size = sd.size;
          if (sd.filename) filename = sd.filename;
          
          host = sd.service?.id || sd.indexer || 'Unknown';
        } else {
          // Fallback if resolved isn't perfectly mapped
          filename = stream.title || 'Stream';
        }

        return {
          url: stream.url || stream.externalUrl,
          title: filename,
          quality: quality,
          size: size,
          host: host,
          badges: badges.join(' | ')
        };
      });

      res.status(200).json({ streams: synclerStreams });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
