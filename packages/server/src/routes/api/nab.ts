import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  ApiTransformer,
  NabTransformer,
  paginateNabFeed,
  type NabNamespace,
  type NabQueryContext,
  renderNabFeedXml,
  renderNabCapsXml,
  nabCapsJson,
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
} from '@aiostreams/core';
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

interface BuiltQuery {
  id: string;
  type: 'movie' | 'series';
  ctx: NabQueryContext;
}

/**
 * Map a newznab/torznab query to a Stremio `(id, type)`. Only ID + season/ep
 * lookups are supported; anything we can't turn into an ID (free-text `q`, or a
 * series query missing season/ep) returns `null` so the caller emits an empty
 * feed.
 */
function buildQuery(t: string, p: Record<string, string>): BuiltQuery | null {
  const season = p.season?.trim();
  const ep = p.ep?.trim();
  const isSeries = t === 'tvsearch' || (t === 'search' && !!season);
  const type: 'movie' | 'series' = isSeries ? 'series' : 'movie';

  const imdb = (p.imdbid ?? '').replace(/\D/g, '');
  const tvdb = (p.tvdbid ?? '').replace(/\D/g, '');
  const tmdb = (p.tmdbid ?? '').replace(/\D/g, '');

  let base: string | undefined;
  let imdbId: string | undefined;
  if (imdb) {
    base = `tt${imdb}`;
    imdbId = `tt${imdb}`;
  } else if (tvdb) {
    base = `tvdb:${tvdb}`;
  } else if (tmdb) {
    base = `tmdb:${tmdb}`;
  }
  if (!base) return null;

  if (type === 'series') {
    // The pipeline is per-episode; a season-only query has no Stremio id.
    if (!season || !ep) return null;
    return {
      id: `${base}:${season}:${ep}`,
      type,
      ctx: { mediaType: 'series', imdbId, season, episode: ep },
    };
  }
  return { id: base, type, ctx: { mediaType: 'movie', imdbId } };
}

/**
 * Build a per-namespace newznab/torznab router mounted at `<base>/api`. Acts as
 * a transformer over the user's stream pipeline (same as the JSON search API).
 */
export function createNabRouter(namespace: NabNamespace): Router {
  const router: Router = Router();
  router.use(corsMiddleware);
  router.use(streamApiRateLimiter);

  const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const emptyFeed = (res: Response, xml: boolean, serverTitle: string) => {
    const feed = {
      title: `${serverTitle} ${titleCase(namespace)}`,
      description: `${serverTitle} ${titleCase(namespace)} results`,
      items: [],
    };
    if (xml) {
      res.type('application/xml').send(renderNabFeedXml(namespace, feed));
    } else {
      res.json(feed);
    }
  };

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
    if (!built) {
      emptyFeed(res, xml, serverTitle);
      return;
    }

    try {
      userData.ip = req.userIp;
      userData = await syncUserDataUrls(userData);
      userData = await validateConfig(userData, {
        skipErrorsFromAddonsOrProxies: true,
        decryptValues: true,
      });

      const aiostreams = new AIOStreams(userData);
      await aiostreams.initialise();
      const response = await aiostreams.getStreams(built.id, built.type);

      const apiData = await new ApiTransformer(userData).transformStreams(
        response,
        []
      );
      const feed = paginateNabFeed(
        new NabTransformer(namespace, serverTitle).transform(
          apiData.results,
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
