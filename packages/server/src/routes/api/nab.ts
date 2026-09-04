import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  NabTransformer,
  paginateNabFeed,
  type NabFeed,
  type NabNamespace,
  type NabQueryContext,
  renderNabFeedXml,
  renderNabCapsXml,
  nabCapsJson,
  nabPlaceholderCategory,
  renderNabErrorXml,
  UserData,
  UserRepository,
  parseCredential,
  isEncrypted,
  decryptString,
  validateConfig,
  config as appConfig,
  constants,
  createLogger,
  activateVariants,
  logVariantNotes,
  parseVariantSelector,
  recordClientAgent,
  VARIANT_QUERY_PARAM,
} from '@aiostreams/core';
import { buildVariantRequestContext } from '../../utils/variant-context.js';
import { corsMiddleware } from '../../middlewares/cors.js';
import { streamApiRateLimiter } from '../../middlewares/ratelimit.js';
import { syncUserDataUrls } from '../../utils/syncUserData.js';
import { wantsXml } from '../../utils/xml-response.js';

const logger = createLogger('server:nab');

/** Flatten the query string into single string values. */
function flatParams(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') out[key] = value[0];
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * A request is a self-call when it carries this instance's internal secret
 * (same-origin requests are stamped with it by `makeRequest`)
 */
function isSelfCall(req: Request): boolean {
  const secret = req.get(constants.INTERNAL_SECRET_HEADER);
  if (secret && secret === appConfig.bootstrap.internalSecret) return true;
  return false;
}

type BuiltQuery =
  | {
      kind: 'stream';
      id: string;
      type: 'movie' | 'series';
      ctx: NabQueryContext;
    }
  | { kind: 'rss'; category: number }
  | { kind: 'unsupported' };

/**
 * Map a newznab/torznab query to a Stremio `(id, type)`. Only ID + season/ep
 * lookups are supported. `rss` is a bare feed request (any search function
 * with nothing to search for) that clients issue to test an indexer;
 * `unsupported` is anything else we can't turn into an ID (free-text `q`, or
 * a series query missing a season).
 */
function buildQuery(t: string, p: Record<string, string>): BuiltQuery {
  const season = p.season?.trim();
  const ep = p.ep?.trim();
  const isSeries = t === 'tvsearch' || (t === 'search' && !!season);
  const type: 'movie' | 'series' = isSeries ? 'series' : 'movie';

  const imdb = (p.imdbid ?? '').replace(/\D/g, '');
  const tvdb = (p.tvdbid ?? '').replace(/\D/g, '');
  const tmdb = (p.tmdbid ?? '').replace(/\D/g, '');

  let base: string | undefined;
  if (imdb) {
    base = `tt${imdb}`;
  } else if (tvdb) {
    base = `tvdb:${tvdb}`;
  } else if (tmdb) {
    base = `tmdb:${tmdb}`;
  }
  if (!base) {
    const bare = !p.q?.trim() && !season && !ep;
    return bare
      ? { kind: 'rss', category: nabPlaceholderCategory(t, p.cat) }
      : { kind: 'unsupported' };
  }

  // Echoed back on every item, whichever id the lookup itself resolved against.
  const ids = {
    imdbId: imdb ? `tt${imdb}` : undefined,
    tvdbId: tvdb || undefined,
    tmdbId: tmdb || undefined,
  };

  if (type === 'series') {
    if (!season) return { kind: 'unsupported' };
    return {
      kind: 'stream',
      id: `${base}:${season}:${ep || '1'}`,
      type,
      ctx: { mediaType: 'series', ...ids, season, episode: ep },
    };
  }
  return {
    kind: 'stream',
    id: base,
    type,
    ctx: { mediaType: 'movie', ...ids },
  };
}

/**
 * Build a per-namespace newznab/torznab router mounted at `<base>/api`. Acts as
 * a transformer over the user's stream pipeline (same as the JSON search API).
 */
export function createNabRouter(namespace: NabNamespace): Router {
  const router: Router = Router();
  router.use(corsMiddleware);
  router.use(streamApiRateLimiter);

  const sendFeed = (res: Response, xml: boolean, feed: NabFeed) => {
    if (xml) {
      res.type('application/xml').send(renderNabFeedXml(namespace, feed));
    } else {
      res.json(feed);
    }
  };

  const emptyFeed = (res: Response, xml: boolean, serverTitle: string) =>
    sendFeed(res, xml, {
      title: `${serverTitle} ${namespace}`,
      description: `${serverTitle} ${namespace} results`,
      items: [],
    });

  const nabError = (
    res: Response,
    status: number,
    code: number,
    description: string,
    xml: boolean
  ) => {
    if (xml) {
      res
        .status(status)
        .type('application/xml')
        .send(renderNabErrorXml(code, description));
    } else {
      res.status(status).json({ error: { code, description } });
    }
  };

  router.get('/api', async (req: Request, res: Response) => {
    const params = flatParams(req);
    const xml = wantsXml(params, 'xml');

    if (!appConfig.api.enableNabApi) {
      nabError(
        res,
        403,
        910,
        'Newznab/Torznab API is disabled on this instance',
        xml
      );
      return;
    }

    const t = params.t?.toLowerCase();
    const serverTitle = appConfig.branding.addonName;

    if (!t) {
      nabError(res, 400, 202, 'Missing required parameter: t', xml);
      return;
    }

    if (t === 'caps') {
      if (xml) {
        res.type('application/xml').send(renderNabCapsXml(serverTitle));
      } else {
        res.json(nabCapsJson(serverTitle));
      }
      return;
    }

    if (t !== 'search' && t !== 'tvsearch' && t !== 'movie') {
      nabError(res, 400, 202, `Unsupported function: ${t}`, xml);
      return;
    }

    if (isSelfCall(req)) {
      logger.warn(
        `${namespace} received a self-referential request; returning empty feed to break the loop`
      );
      emptyFeed(res, xml, serverTitle);
      return;
    }

    const creds = parseCredential(params.apikey);
    if (!creds) {
      nabError(res, 401, 100, 'Incorrect user credentials', xml);
      return;
    }
    let password = creds.password;
    if (isEncrypted(password)) {
      const { success, data } = decryptString(password);
      if (!success) {
        nabError(res, 401, 100, 'Incorrect user credentials', xml);
        return;
      }
      password = data;
    }

    let userData: UserData | null = null;
    try {
      const userExists = await UserRepository.checkUserExists(creds.username);
      if (userExists) {
        userData = await UserRepository.getUser(creds.username, password);
      }
    } catch {
      userData = null;
    }
    if (!userData) {
      nabError(res, 401, 100, 'Incorrect user credentials', xml);
      return;
    }

    const built = buildQuery(t, params);
    if (built.kind === 'rss') {
      sendFeed(
        res,
        xml,
        new NabTransformer(namespace, serverTitle).rssPlaceholder(
          built.category
        )
      );
      return;
    }
    if (built.kind === 'unsupported') {
      emptyFeed(res, xml, serverTitle);
      return;
    }

    try {
      userData.ip = req.userIp;
      const selectedVariants = parseVariantSelector(
        req.query[VARIANT_QUERY_PARAM]
      );
      const variantContext = {
        ...buildVariantRequestContext(req, 'nab'),
        type: built.type,
        id: built.id,
      };
      void recordClientAgent(userData.uuid, variantContext.userAgent, 'nab');
      const activation = await activateVariants(
        userData,
        selectedVariants,
        variantContext
      );
      userData = activation.userData;
      if (activation.applied.length) {
        logger.info(
          {
            uuid: userData.uuid,
            resource: 'nab',
            variants: userData.activeVariants,
            auto: activation.auto,
          },
          'serving request with config variants'
        );
        logVariantNotes(userData.uuid, activation);
      }
      userData = await syncUserDataUrls(userData);
      userData = await validateConfig(userData, {
        skipErrorsFromAddonsOrProxies: true,
        decryptValues: true,
      });

      const aiostreams = new AIOStreams(userData);
      await aiostreams.initialise();
      const response = await aiostreams.getStreams(built.id, built.type);

      const feed = paginateNabFeed(
        new NabTransformer(namespace, serverTitle).transform(
          response.data.streams,
          built.ctx
        ),
        {
          limit: Number.parseInt(params.limit ?? '', 10),
          offset: Number.parseInt(params.offset ?? '', 10),
        }
      );

      if (xml) {
        res.type('application/xml').send(renderNabFeedXml(namespace, feed));
      } else {
        res.json(feed);
      }
    } catch (error: any) {
      logger.error(`${namespace} search failed: ${error?.message ?? error}`);
      nabError(res, 500, 900, 'Search failed', xml);
    }
  });

  return router;
}

export default createNabRouter;
