import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  accountScope,
  config as appConfig,
  createLogger,
  getWatchStateProvider,
  itemIdForWatchRow,
  PlaybackHandoffRepository,
  personaUserId,
  readToken,
  UserRepository,
  WatchSessionRepository,
  WatchStateRepository,
  type JellyfinPersona,
  type WatchHistoryCursor,
  type WatchScope,
  type WatchStateRow,
} from '@aiostreams/core';
import {
  bodyOf,
  jf,
  accountLocked,
  personaById,
  personaLocked,
  userUnlocks,
  personasOf,
  qi,
  qs,
  type JellyfinRequestContext,
} from './context.js';
import { summaryItem } from './items.js';
import { mapLimited, ROW_CONCURRENCY } from './library.js';
import { authenticationResult, sessionFromRow, userDto } from './users.js';
import { jellyfinLoginRateLimiter } from '../../middlewares/ratelimit.js';

/* The server's own web app; an API key is another tool's credential and may not use it. */

const logger = createLogger('jellyfin');
const router: Router = Router({ mergeParams: true });

const SESSIONS_LIMIT = 50;
const HISTORY_PAGE = 50;
const HISTORY_PAGE_MAX = 200;
const CLEAR_KEYS_MAX = 1000;

function web(
  handler: (
    req: Request,
    res: Response,
    ctx: JellyfinRequestContext
  ) => Promise<void>
) {
  return jf(async (req, res, ctx) => {
    if (ctx.apiKey) {
      res.status(403).json({ Message: 'Not available to API keys' });
      return;
    }
    await handler(req, res, ctx);
  });
}

interface WebUser {
  persona: JellyfinPersona | null;
  id: string;
  /** The history this user reads and writes. */
  scope: WatchScope;
}

function usersOf(ctx: JellyfinRequestContext): WebUser[] {
  const account = accountScope(ctx.uuid);
  return [
    { persona: null, id: personaUserId(ctx.uuid, ''), scope: account },
    ...personasOf(ctx.userData).map((p) => ({
      persona: p,
      id: personaUserId(ctx.uuid, p.id),
      scope:
        p.history === 'shared' ? account : { uuid: ctx.uuid, persona: p.id },
    })),
  ];
}

function ownsScope(user: WebUser): boolean {
  return user.scope.persona === (user.persona?.id ?? '');
}

/**
 * Who the caller may read here: a persona only itself, the configuration's own
 * user everyone, as it is the one that holds the personas.
 */
function visibleUsers(ctx: JellyfinRequestContext): WebUser[] {
  const users = usersOf(ctx);
  if (!ctx.persona) return users;
  return users.filter((u) => u.persona?.id === ctx.persona?.id);
}

/** A session whose credential also opens the account. */
function openedAsAccount(ctx: JellyfinRequestContext): boolean {
  return !ctx.persona || readToken(ctx.token)?.o === 1;
}

function isCaller(ctx: JellyfinRequestContext, user: WebUser): boolean {
  return (user.persona?.id ?? '') === (ctx.persona?.id ?? '');
}

/** What switching to `user` asks of the caller. */
function secretFor(
  ctx: JellyfinRequestContext,
  user: WebUser
): 'pin' | 'password' | null {
  if (isCaller(ctx, user)) return null;
  if (user.persona) return personaLocked(user.persona) ? 'pin' : null;
  // A PIN is asked on every switch, or handing over a signed-in device would
  // hand over the account.
  if (accountLocked(ctx.userData)) return 'pin';
  return openedAsAccount(ctx) ? null : 'password';
}

function avatarOf(ctx: JellyfinRequestContext, user: WebUser): string | null {
  return (
    (user.persona
      ? user.persona.avatar
      : ctx.userData.jellyfin?.primary?.avatar) ?? null
  );
}

function encodeCursor(row: WatchStateRow): string {
  return Buffer.from(
    JSON.stringify([row.sortAt, row.persona, row.itemKey])
  ).toString('base64url');
}

function decodeCursor(raw: string | undefined): WatchHistoryCursor | undefined {
  if (!raw) return undefined;
  try {
    const [sortAt, persona, itemKey] = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8')
    );
    if (
      typeof sortAt === 'number' &&
      typeof persona === 'string' &&
      typeof itemKey === 'string'
    ) {
      return { sortAt, persona, itemKey };
    }
  } catch {}
  return undefined;
}

router.get(
  '/AIOStreams/Activity',
  web(async (_req, res, ctx) => {
    const users = visibleUsers(ctx);
    const [counts, rows] = await Promise.all([
      WatchStateRepository.historyCounts(ctx.uuid),
      ctx.persona
        ? []
        : WatchSessionRepository.listForUuid(ctx.uuid, SESSIONS_LIMIT),
    ]);
    const idleSince =
      Date.now() - appConfig.watchState.sessionIdleTimeout * 1000;
    const sessions = await Promise.all(
      rows
        .filter((row) => row.endedAt == null && row.lastCheckinAt >= idleSince)
        .map((row) => {
          const key = row.userPersona ?? row.persona;
          const user = key ? personaById(ctx.userData, key) : null;
          return key && !user ? null : sessionFromRow(ctx, row, user, null);
        })
    );
    const byScope = new Map(counts.map((c) => [c.persona, c]));
    const none = {
      played: 0,
      movies: 0,
      episodes: 0,
      inProgress: 0,
      favorites: 0,
      lastAt: null,
    };
    res.json({
      users: users.map((u) => ({
        user: userDto(ctx.uuid, ctx.userData, u.persona),
        avatar: avatarOf(ctx, u),
        hidden: !!u.persona?.hidden,
        locked: u.persona
          ? personaLocked(u.persona)
          : accountLocked(ctx.userData),
        historyOf: personaUserId(ctx.uuid, u.scope.persona),
        counts: ownsScope(u) ? (byScope.get(u.scope.persona) ?? none) : null,
      })),
      sessions: sessions.filter(Boolean),
    });
  })
);

/*
 * Who the user picker offers. Hidden users show only to the account, which
 * keeps them, and to themselves.
 */
router.get(
  '/AIOStreams/Users',
  web(async (_req, res, ctx) => {
    res.json(
      usersOf(ctx)
        .filter((u) => !u.persona?.hidden || !ctx.persona || isCaller(ctx, u))
        .map((u) => ({
          user: userDto(ctx.uuid, ctx.userData, u.persona),
          avatar: avatarOf(ctx, u),
          hidden: !!u.persona?.hidden,
          needs: secretFor(ctx, u),
        }))
    );
  })
);

router.get(
  '/AIOStreams/History',
  web(async (req, res, ctx) => {
    const users = visibleUsers(ctx);
    const wanted = qs(req, 'userId')?.toLowerCase();
    const scoped = wanted ? users.find((u) => u.id === wanted) : undefined;
    if (wanted && !scoped) {
      res.status(404).json({ Message: 'User not found' });
      return;
    }
    const personas = scoped
      ? [scoped.scope.persona]
      : [...new Set(users.filter(ownsScope).map((u) => u.scope.persona))];
    const limit = Math.min(
      Math.max(1, qi(req, 'limit', HISTORY_PAGE)),
      HISTORY_PAGE_MAX
    );
    const rows = await WatchStateRepository.listHistory(ctx.uuid, personas, {
      limit: limit + 1,
      after: decodeCursor(qs(req, 'cursor')),
      localOnly: qs(req, 'source') === 'local',
    });
    const page = rows.slice(0, limit);
    const trackers = page.some((r) => r.origin === 'import')
      ? new Map(
          (await PlaybackHandoffRepository.listAllSinks(ctx.uuid)).map((s) => [
            s.id,
            s.addonName ?? s.addonInstanceId,
          ])
        )
      : new Map<string, string>();
    const items = await mapLimited(page, ROW_CONCURRENCY, (row) =>
      summaryItem(ctx, row)
    );
    res.json({
      items: page.map((row, i) => ({
        userId: personaUserId(ctx.uuid, row.persona),
        itemKey: row.itemKey,
        kind: row.kind,
        played: row.played,
        playCount: row.playCount,
        positionMs: row.positionMs,
        durationMs: row.durationMs,
        favorite: row.favorite,
        lastPlayedAt: row.lastPlayedAt,
        sortAt: row.sortAt,
        origin: row.origin,
        tracker: row.sinkId ? (trackers.get(row.sinkId) ?? null) : null,
        item: items[i] ?? {
          Id: itemIdForWatchRow(row),
          Name: row.snapshot?.name ?? row.baseId,
          SeriesName: row.snapshot?.seriesName,
          IndexNumber: row.episode ?? undefined,
          ParentIndexNumber: row.season ?? undefined,
          Type: row.kind === 'episode' ? 'Episode' : 'Movie',
        },
      })),
      cursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    });
  })
);

const clearBody = z.object({
  userId: z.string().min(1),
  itemKeys: z.array(z.string().min(1)).min(1).max(CLEAR_KEYS_MAX).optional(),
});

/* Local only: a tracker that still lists a title brings it back on its next sync. */
router.post(
  '/AIOStreams/History/Clear',
  web(async (req, res, ctx) => {
    const parsed = clearBody.safeParse(bodyOf(req));
    if (!parsed.success) {
      res
        .status(400)
        .json({ Message: 'userId and optional itemKeys expected' });
      return;
    }
    const user = visibleUsers(ctx).find(
      (u) => u.id === parsed.data.userId.toLowerCase()
    );
    if (!user) {
      res.status(404).json({ Message: 'User not found' });
      return;
    }
    const cleared = await getWatchStateProvider().clear(
      user.scope,
      parsed.data.itemKeys
    );
    logger.info(
      {
        uuid: ctx.uuid,
        persona: user.scope.persona,
        cleared,
        all: !parsed.data.itemKeys,
      },
      'watch history cleared'
    );
    res.json({ cleared });
  })
);

router.get(
  '/AIOStreams/History/Export',
  web(async (_req, res, ctx) => {
    const users = visibleUsers(ctx);
    const scopes = new Set(users.filter(ownsScope).map((u) => u.scope.persona));
    const rows = (await WatchStateRepository.listForUuid(ctx.uuid)).filter(
      (r) => scopes.has(r.persona)
    );
    const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="watch-history-${ctx.uuid.slice(0, 8)}.json"`
    );
    res.json({
      exportedAt: new Date().toISOString(),
      users: users.filter(ownsScope).map((u) => ({
        id: u.id,
        persona: u.scope.persona,
        name: userDto(ctx.uuid, ctx.userData, u.persona).Name,
      })),
      rows: rows.map((r) => ({
        persona: r.persona,
        itemKey: r.itemKey,
        kind: r.kind,
        type: r.mediaType,
        id: r.baseId,
        season: r.season,
        episode: r.episode,
        videoId: r.videoId,
        played: r.played,
        playCount: r.playCount,
        positionMs: r.positionMs,
        durationMs: r.durationMs,
        favorite: r.favorite,
        lastPlayedAt: iso(r.lastPlayedAt),
        updatedAt: iso(r.updatedAt),
        origin: r.origin,
      })),
    });
  })
);

/*
 * Switches user. A user with a PIN asks for it; a session holding a persona
 * alone asks for the configuration's password to reach an account without one.
 */
router.post(
  '/AIOStreams/Token',
  web(async (req, res, ctx) => {
    const body = bodyOf(req);
    const wanted = String(body.UserId ?? '').toLowerCase();
    const secret = String(body.Pw ?? '');
    const user = usersOf(ctx).find((u) => u.id === wanted);
    if (!user) {
      res.status(404).json({ Message: 'User not found' });
      return;
    }
    const needs = secretFor(ctx, user);
    if (needs && !(await jellyfinLoginRateLimiter.tryConsume(req))) {
      res.status(429).json({ Message: 'Too many attempts' });
      return;
    }
    const allowed =
      needs === 'pin'
        ? await userUnlocks(ctx.uuid, ctx.userData, user.persona, secret)
        : needs === 'password'
          ? await UserRepository.verifyUser(ctx.uuid, secret).then(
              () => true,
              () => false
            )
          : true;
    if (!allowed) {
      res.status(401).json({ Message: 'Invalid password' });
      return;
    }
    res.json(
      await authenticationResult(
        req,
        ctx.uuid,
        ctx.encryptedPassword,
        ctx.userData,
        user.persona,
        { openedAsAccount: openedAsAccount(ctx) }
      )
    );
  })
);

export default router;
