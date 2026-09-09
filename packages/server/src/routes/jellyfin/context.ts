import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  AIOStreams,
  APIError,
  Cache,
  accountScope,
  activateVariants,
  config as appConfig,
  constants,
  createLogger,
  extractAuth,
  getDb,
  getSimpleTextHash,
  isConfigUuid,
  isEncrypted,
  mintToken,
  readToken,
  resolveConfigAlias,
  memoScope,
  personaUserId,
  resolveVariantSelector,
  serverId as instanceServerId,
  sql,
  UserRepository,
  validateConfig,
  VARIANT_PATH_PARAM,
  VARIANT_QUERY_PARAM,
  decryptString,
  type ClientInfo,
  type ItemBuildContext,
  type JellyfinPersona,
  type UserData,
  type WatchScope,
} from '@aiostreams/core';
import { syncUserDataUrls } from '../../utils/syncUserData.js';
import { buildVariantRequestContext } from '../../utils/variant-context.js';

const logger = createLogger('jellyfin');

export interface JellyfinRequestContext {
  uuid: string;
  encryptedPassword: string;
  userData: UserData;
  userId: string;
  /** Who is signed in; null for the account. */
  persona: JellyfinPersona | null;
  /** The history in use: the account's when the persona shares it. */
  watch: WatchScope;
  serverId: string;
  /** Absolute origin plus mount path, e.g. https://host/jellyfin */
  baseUrl: string;
  token: string;
  client: ClientInfo;
  preAuthenticated: boolean;
  build: ItemBuildContext;
  engine(): Promise<AIOStreams>;
  /** The primary user's configuration, whose sinks are the ones trackers sync with. */
  primaryEngine(): Promise<AIOStreams>;
  /** Playback memos are keyed by this, so a config change never reuses them. */
  scope(): string;
}

/*
 * The expensive, request-independent part of serving a config (load, decrypt,
 * sync remote lists, validate) is cached per config; the engine itself is
 * built per request because it carries request state.
 */
interface CachedConfig {
  userData: UserData;
  updatedAt: string;
  checkedAt: number;
}
const CONFIG_TTL = 300;
const RECHECK_MS = 30_000;
const configCache = Cache.getInstance<string, CachedConfig>(
  'jellyfin-config',
  5000,
  'memory'
);
const inFlight = new Map<string, Promise<CachedConfig | null>>();

async function configUpdatedAt(uuid: string): Promise<string> {
  const row = await getDb().maybeOne<{ updated_at: string | Date | null }>(
    sql`SELECT updated_at FROM users WHERE uuid = ${uuid}`
  );
  const v = row?.updated_at;
  return v instanceof Date ? v.toISOString() : String(v ?? '');
}

async function loadConfig(
  uuid: string,
  encryptedPassword: string
): Promise<CachedConfig | null> {
  const dec = decryptString(encryptedPassword);
  if (!dec.success || dec.data == null) return null;
  let userData: UserData | null;
  try {
    userData = await UserRepository.getUser(uuid, dec.data);
  } catch (error) {
    if (
      error instanceof APIError &&
      error.code === constants.ErrorCode.USER_INVALID_DETAILS
    ) {
      return null;
    }
    throw error;
  }
  if (!userData) return null;
  userData.uuid = uuid;
  userData.encryptedPassword = encryptedPassword;
  userData.ip = undefined;
  userData = await syncUserDataUrls(userData);
  userData = await validateConfig(userData, {
    skipErrorsFromAddonsOrProxies: true,
    decryptValues: true,
  });
  return {
    userData,
    updatedAt: await configUpdatedAt(uuid),
    checkedAt: Date.now(),
  };
}

export async function resolveUuid(uuidOrAlias: string): Promise<string | null> {
  if (isConfigUuid(uuidOrAlias)) return uuidOrAlias;
  const alias = await resolveConfigAlias(uuidOrAlias);
  return alias?.uuid ?? null;
}

/** Returns a fresh copy of the resolved config, or null when the credentials are wrong. */
export async function resolveConfig(
  uuid: string,
  encryptedPassword: string
): Promise<UserData | null> {
  const key = `${uuid}|${getSimpleTextHash(encryptedPassword)}`;
  let entry = await configCache.get(key).catch(() => undefined);
  if (entry && Date.now() - entry.checkedAt > RECHECK_MS) {
    const updatedAt = await configUpdatedAt(uuid);
    if (updatedAt !== entry.updatedAt) {
      await configCache.delete(key).catch(() => undefined);
      entry = undefined;
    } else {
      entry = { ...entry, checkedAt: Date.now() };
      void configCache.set(key, entry, CONFIG_TTL).catch(() => undefined);
    }
  }
  if (!entry) {
    let pending = inFlight.get(key);
    if (!pending) {
      pending = loadConfig(uuid, encryptedPassword).finally(() =>
        inFlight.delete(key)
      );
      inFlight.set(key, pending);
    }
    const loaded = await pending;
    if (!loaded) return null;
    entry = loaded;
    void configCache.set(key, entry, CONFIG_TTL).catch(() => undefined);
  }
  return structuredClone(entry.userData);
}

/** Cheap credential check for routes that only need to know the caller is real. */
export async function verifyCredentials(
  uuidOrAlias: string,
  encryptedPassword: string
): Promise<string | null> {
  const uuid = await resolveUuid(uuidOrAlias);
  if (!uuid) return null;
  const dec = decryptString(encryptedPassword);
  if (!dec.success || dec.data == null) return null;
  try {
    await UserRepository.verifyUser(uuid, dec.data);
    return uuid;
  } catch {
    return null;
  }
}

export function personasOf(userData: UserData): JellyfinPersona[] {
  return userData.jellyfin?.personas ?? [];
}

export function personaById(
  userData: UserData,
  id: string
): JellyfinPersona | null {
  return personasOf(userData).find((p) => p.id === id) ?? null;
}

/** What a client types or posts back: the id, or the name it was shown. */
export function personaByName(
  userData: UserData,
  name: string
): JellyfinPersona | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return (
    personasOf(userData).find(
      (p) => p.id === wanted || p.name.trim().toLowerCase() === wanted
    ) ?? null
  );
}

export function requestOrigin(req: Request): string {
  const host = req.get('host');
  if (host) return `${req.protocol}://${host}`;
  if (appConfig.bootstrap.baseUrl)
    return appConfig.bootstrap.baseUrl.replace(/\/$/, '');
  return `http://localhost:${appConfig.bootstrap.port}`;
}

export function param(req: Request, name: string): string {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** Query lookup that ignores key case, as ASP.NET does. */
export function qs(req: Request, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(req.query)) {
    if (k.toLowerCase() === lower) {
      if (typeof v === 'string') return v;
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    }
  }
  return undefined;
}

export function qi(req: Request, name: string, fallback: number): number {
  const v = qs(req, name);
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function qb(req: Request, name: string): boolean | undefined {
  const v = qs(req, name)?.toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

export function qlist(req: Request, name: string): string[] {
  const v = qs(req, name);
  if (!v) return [];
  return v
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object'
    ? (req.body as Record<string, unknown>)
    : {};
}

/** Routes that must answer without a credential (clients send none). */
const ANONYMOUS_OK = [
  /^\/system\/info\/public$/i,
  /^\/system\/ping$/i,
  /^\/system\/endpoint$/i,
  /^\/users\/authenticatebyname$/i,
  /^\/users\/authenticatewithquickconnect$/i,
  /^\/users\/public$/i,
  /^\/branding\//i,
  /^\/quickconnect\/(enabled|initiate|connect)$/i,
  /^\/startup\//i,
  /^\/items\/[^/]+\/images(\/|$)/i,
  /^\/persons\/[^/]+\/images(\/|$)/i,
  /^\/userimage$/i,
  /^\/users\/[^/]+\/images(\/|$)/i,
  /^\/images\/general\//i,
  /^\/videos\/[^/]+\/stream(\.|\/|$)/i,
  /^\/videos\/[^/]+\/[^/]+\/subtitles\//i,
  /^\/items\/[^/]+\/(download|file)$/i,
  /^\/items\/[^/]+$/i,
  /^\/items\/[^/]+\/playbackinfo$/i,
  /^\/items\/[^/]+\/mediasources$/i,
  /^\/web\/manifest\.json$/i,
];

export function isAnonymousOk(path: string): boolean {
  return ANONYMOUS_OK.some((re) => re.test(path));
}

/**
 * Only Infuse builds its version picker from the list document; clients that
 * render a row's sources directly would offer the placeholders as versions.
 */
function wantsListVersions(req: Request, client: ClientInfo): boolean {
  return /infuse/i.test(`${client.name} ${req.get('user-agent') ?? ''}`);
}

async function buildContext(
  req: Request,
  uuid: string,
  encryptedPassword: string,
  token: string | undefined,
  client: ClientInfo,
  preAuthenticated: boolean,
  personaKey: string
): Promise<JellyfinRequestContext | null> {
  let userData = await resolveConfig(uuid, encryptedPassword);
  if (!userData) return null;
  userData.ip = req.userIp;
  const baseUserData = userData;

  // A token naming a persona that no longer exists is no longer valid.
  const persona = personaKey ? personaById(userData, personaKey) : null;
  if (personaKey && !persona) return null;
  const primaryVariants = userData.jellyfin?.primary?.variants ?? [];
  const variantContext = buildVariantRequestContext(req, 'jellyfin');

  try {
    const { ids: fromUrl, location } = resolveVariantSelector(
      (req.params as Record<string, unknown>)[VARIANT_PATH_PARAM],
      req.query[VARIANT_QUERY_PARAM]
    );
    // The URL is the more immediate choice, so it applies last and wins.
    const own = persona ? (persona.variants ?? []) : primaryVariants;
    const linked = own.filter((id) => !fromUrl.includes(id));
    const selected = [...linked, ...fromUrl];
    const maxActive = appConfig.userLimits.variants.maxActive;
    if (selected.length > maxActive) {
      logger.warn(
        { uuid, persona: persona?.id, dropped: selected.slice(maxActive) },
        'too many variants for one request, dropping the last'
      );
      selected.length = maxActive;
    }
    const result = await activateVariants(userData, selected, variantContext);
    userData = result.userData;
    if (fromUrl.length) userData.variantSelectorLocation = location;
  } catch (error) {
    logger.warn(
      {
        uuid,
        persona: persona?.id,
        err: error instanceof Error ? error.message : String(error),
      },
      'variant activation failed for jellyfin request'
    );
  }

  const serverIdValue = instanceServerId();
  const baseUrl = `${requestOrigin(req)}${req.baseUrl}`.replace(/\/$/, '');
  let engine: Promise<AIOStreams> | null = null;
  let primaryEngine: Promise<AIOStreams> | null = null;
  let scope: string | null = null;
  const finalUserData = userData;
  const engineOf = (data: UserData) =>
    new AIOStreams(data, { skipFailedAddons: true }).initialise();
  const getEngine = () => (engine ??= engineOf(finalUserData));
  const getPrimaryEngine = () => {
    if (!persona) return getEngine();
    return (primaryEngine ??= activateVariants(
      baseUserData,
      primaryVariants,
      variantContext
    ).then(
      (r) => engineOf(r.userData),
      () => engineOf(baseUserData)
    ));
  };
  const userId = personaUserId(uuid, persona?.id ?? '');
  const watch: WatchScope =
    persona && persona.history !== 'shared'
      ? { uuid, persona: persona.id }
      : accountScope(uuid);
  return {
    uuid,
    encryptedPassword,
    userData: finalUserData,
    userId,
    persona,
    watch,
    serverId: serverIdValue,
    baseUrl,
    token:
      token ??
      mintToken({
        u: uuid,
        p: encryptedPassword,
        d: client.deviceId,
        k: persona?.id,
      }),
    client,
    preAuthenticated,
    build: {
      serverId: serverIdValue,
      userId,
      uuid,
      listVersions: wantsListVersions(req, client),
    },
    engine: getEngine,
    primaryEngine: getPrimaryEngine,
    scope: () => (scope ??= memoScope(finalUserData)),
  };
}

export const jellyfinContext: RequestHandler = async (req, res, next) => {
  try {
    const params = req.params as Record<string, string | undefined>;
    const { token, client } = extractAuth({
      header: (name) => req.get(name),
      query: req.query as Record<string, unknown>,
    });

    let uuid: string | undefined;
    let encryptedPassword: string | undefined;
    let preAuthenticated = false;
    // Read on both branches: the path proves the credential, the token names the persona.
    const payload = token ? readToken(token) : null;

    if (params.uuid && params.encryptedPassword) {
      if (!isEncrypted(params.encryptedPassword)) {
        next('router');
        return;
      }
      const resolved = await resolveUuid(params.uuid);
      if (!resolved) {
        res.status(401).json({ Message: 'Unknown configuration' });
        return;
      }
      uuid = resolved;
      encryptedPassword = params.encryptedPassword;
      preAuthenticated = true;
    } else if (payload) {
      uuid = payload.u;
      encryptedPassword = payload.p;
    }

    if (!uuid || !encryptedPassword) {
      if (isAnonymousOk(req.path)) {
        req.jfClient = client;
        next();
        return;
      }
      res.status(401).json({ Message: 'Unauthorized' });
      return;
    }

    // A token minted for another configuration lends it no persona.
    const personaKey = payload && payload.u === uuid ? (payload.k ?? '') : '';
    const ctx = await buildContext(
      req,
      uuid,
      encryptedPassword,
      token,
      client,
      preAuthenticated,
      personaKey
    );
    if (!ctx) {
      if (isAnonymousOk(req.path)) {
        req.jfClient = client;
        next();
        return;
      }
      res.status(401).json({ Message: 'Invalid credentials' });
      return;
    }
    req.jf = ctx;
    req.jfClient = client;
    req.uuid = ctx.uuid;
    req.userData = ctx.userData;
    next();
  } catch (error) {
    logger.error(
      {
        path: req.originalUrl,
        err: error instanceof Error ? error.message : String(error),
      },
      'jellyfin context failed'
    );
    res.status(500).json({ Message: 'Internal error' });
  }
};

export function requireContext(
  req: Request,
  res: Response
): JellyfinRequestContext | null {
  if (!req.jf) {
    res.status(401).json({ Message: 'Unauthorized' });
    return null;
  }
  return req.jf;
}

/** Wraps an authenticated handler with the context and uniform error handling. */
export function jf(
  handler: (
    req: Request,
    res: Response,
    ctx: JellyfinRequestContext
  ) => Promise<void> | void
): RequestHandler {
  return async (req, res, next: NextFunction) => {
    const ctx = requireContext(req, res);
    if (!ctx) return;
    try {
      await handler(req, res, ctx);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { path: req.originalUrl, err: msg },
        'jellyfin handler failed'
      );
      if (!res.headersSent) res.status(500).json({ Message: msg });
      else next(error);
    }
  };
}

/** Same as {@link jf} for routes that may run without a context. */
export function jfOptional(
  handler: (
    req: Request,
    res: Response,
    ctx: JellyfinRequestContext | undefined
  ) => Promise<void> | void
): RequestHandler {
  return async (req, res, next: NextFunction) => {
    try {
      await handler(req, res, req.jf);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { path: req.originalUrl, err: msg },
        'jellyfin handler failed'
      );
      if (!res.headersSent) res.status(500).json({ Message: msg });
      else next(error);
    }
  };
}

/**
 * Builds a context from stored credentials, for anonymous routes that found a
 * memo. Always the account: these routes serve content and write no history.
 */
export function contextFromCredentials(
  req: Request,
  uuid: string,
  encryptedPassword: string
): Promise<JellyfinRequestContext | null> {
  return buildContext(
    req,
    uuid,
    encryptedPassword,
    undefined,
    req.jfClient ?? {
      name: 'Unknown',
      device: 'Unknown',
      deviceId: 'unknown',
      version: '0',
    },
    false,
    ''
  );
}
