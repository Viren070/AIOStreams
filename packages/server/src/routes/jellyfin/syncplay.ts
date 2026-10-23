import { Router, type Request, type Response } from 'express';
import {
  config as appConfig,
  createLogger,
  descriptorForWatchRow,
  encodeItemId,
  hyphenless,
  isGuidLike,
  msToTicks,
  sessionKeyFor,
  sharedBackend,
  SharedTx,
  syncId,
  SyncGroup,
  WatchSessionRepository,
  type GroupMessage,
  type GroupRequest,
  type PlayingOnCreate,
  type PlaylistItem,
  type QueueItem,
  type QueueSnapshot,
  type SavedGroup,
  type SharedMessage,
} from '@aiostreams/core';
import { withinQueue } from '../../party/limits.js';
import {
  bodyField,
  jf,
  jfOptional,
  param,
  type JellyfinRequestContext,
} from './context.js';
import { accountName } from './users.js';
import {
  clientKey,
  frame,
  onClientOffline,
  onClientOnline,
  sendFrameToClient,
} from './session-sockets.js';

/*
 * Jellyfin's SyncPlay for Jellyfin apps, over the shared group engine. Members
 * are clients (a user on a device), which hear the group on their session
 * socket, on whichever replica holds it.
 */

const logger = createLogger('jellyfin');

/** A dropped socket keeps its place this long, as TVs drop theirs. */
const GRACE_MS = 30_000;
const MAX_QUEUE = 500;
const MAX_NAME = 100;
const PLAYING_FRESH_MS = 60_000;

interface Home {
  uuid: string;
  userId: string;
  /** Started by a user others don't see, who alone sees it. */
  hidden: boolean;
}

interface Group {
  group: SyncGroup;
  home: Home;
  /** Members without a socket anywhere, and when they are given up. */
  away: Record<string, number>;
}

interface SavedGroupRecord {
  group: SavedGroup;
  home: Home;
  away: Record<string, number>;
}

const store = sharedBackend();
const groups = store.records<Group>({
  name: 'syncplay',
  save: (g): SavedGroupRecord => ({
    group: g.group.save(),
    home: g.home,
    away: g.away,
  }),
  bulk: (g) => g.group.queue.items,
  load: (saved: SavedGroupRecord, items: PlaylistItem[] | null) => ({
    ...saved,
    group: SyncGroup.restore(saved.group, items ?? [], deliver),
  }),
  due: (g) => {
    let due = g.group.waitDeadline ?? Infinity;
    for (const until of Object.values(g.away)) due = Math.min(due, until);
    return Number.isFinite(due) ? due : null;
  },
  tags: () => ['groups'],
  refs: (g) => g.group.memberList().map((m) => m.id),
  receive,
  lapse,
  orphaned,
});

/** The group being changed, which its messages go out through. */
let current: { group: SyncGroup; tx: SharedTx } | undefined;

function changing<R>(g: Group, tx: SharedTx, fn: () => R): R {
  current = { group: g.group, tx };
  try {
    return fn();
  } finally {
    current = undefined;
  }
}

const ticks = (ms: number) => msToTicks(Math.max(ms, 0));
const iso = (ms: number) => new Date(ms).toISOString();

function groupInfo(group: SyncGroup) {
  const info = group.info();
  return {
    GroupId: info.id,
    GroupName: info.name,
    State: info.state,
    Participants: info.participants,
    LastUpdatedAt: iso(info.lastUpdatedAt),
  };
}

function playQueue(queue: QueueSnapshot) {
  return {
    Reason: queue.reason,
    LastUpdate: iso(queue.lastUpdate),
    Playlist: queue.playlist.map((item) => ({
      ItemId: item.ref,
      PlaylistItemId: item.playlistItemId,
    })),
    PlayingItemIndex: queue.playingIndex,
    StartPositionTicks: ticks(queue.startPositionMs),
    IsPlaying: queue.isPlaying,
    ShuffleMode: queue.shuffleMode,
    RepeatMode: queue.repeatMode,
  };
}

function groupUpdate(group: SyncGroup, type: string, data: unknown) {
  return { GroupId: group.id, Type: type, Data: data };
}

function deliver(to: readonly string[], message: GroupMessage): void {
  if (!current) return;
  const { group, tx } = current;
  let type = 'SyncPlayGroupUpdate';
  let data: unknown;
  switch (message.kind) {
    case 'command':
      type = 'SyncPlayCommand';
      data = {
        GroupId: group.id,
        PlaylistItemId: message.command.playlistItemId,
        When: iso(message.command.when),
        PositionTicks: ticks(message.command.positionMs),
        Command: message.command.command,
        EmittedAt: iso(message.command.emittedAt),
      };
      break;
    case 'joined':
      data = groupUpdate(group, 'GroupJoined', groupInfo(group));
      break;
    case 'left':
      data = groupUpdate(group, 'GroupLeft', group.id);
      break;
    case 'user-joined':
      data = groupUpdate(group, 'UserJoined', message.member.name);
      break;
    case 'user-left':
      data = groupUpdate(group, 'UserLeft', message.member.name);
      break;
    case 'queue':
      data = groupUpdate(group, 'PlayQueue', playQueue(message.queue));
      break;
    case 'state':
      data = groupUpdate(group, 'StateUpdate', {
        State: message.state,
        Reason: message.reason,
      });
      break;
  }
  tx.send(to, Buffer.from(frame(type, data)));
}

function receive(_id: string, messages: readonly SharedMessage[]): void {
  for (const { to, data } of messages)
    for (const key of to) sendFrameToClient(key, data);
}

/** Members away too long leave, unless they came back meanwhile; waits run out. */
async function lapse(id: string): Promise<void> {
  const found = await groups.get(id);
  if (!found) return;
  const at = Date.now();
  const gone = Object.keys(found.away).filter((key) => found.away[key] <= at);
  const back = new Set<string>();
  for (const key of gone) if (await store.presence.online(key)) back.add(key);
  await groups.update(id, (g, tx) =>
    changing(g, tx, () => {
      for (const key of gone) {
        if (!(key in g.away)) continue;
        delete g.away[key];
        if (!back.has(key)) g.group.leave(key);
      }
      if (!g.group.size) return tx.drop();
      g.group.tick();
    })
  );
}

/** Clients of a replica that went without saying are away, unless elsewhere. */
async function orphaned(replica: string): Promise<void> {
  for (const key of await store.presence.of(replica)) await went(key);
}

async function went(key: string): Promise<void> {
  const id = await groups.find(key);
  if (!id || (await store.presence.online(key))) return;
  await groups.update(id, (g) => {
    if (g.group.member(key)) g.away[key] = Date.now() + GRACE_MS;
  });
}

async function returned(key: string): Promise<void> {
  const id = await groups.find(key);
  if (!id) return;
  await groups.update(id, (g) => {
    delete g.away[key];
  });
}

const failed = (err: unknown) =>
  logger.warn(
    { err: err instanceof Error ? err.message : err },
    'syncplay presence failed'
  );

onClientOffline((key) => void went(key).catch(failed));
onClientOnline((key) => void returned(key).catch(failed));

/** To the client's socket, on whichever replica holds it. */
function notice(key: string, type: string) {
  const tx = new SharedTx();
  tx.send(
    [key],
    Buffer.from(
      frame('SyncPlayGroupUpdate', { GroupId: '', Type: type, Data: '' })
    )
  );
  groups.broadcast(tx);
}

/** Takes the client out of its group, which ends once empty. */
async function leave(key: string): Promise<boolean> {
  const id = await groups.find(key);
  if (!id) return false;
  const left = await groups.update(id, (g, tx) =>
    changing(g, tx, () => {
      if (!g.group.member(key)) return false;
      delete g.away[key];
      g.group.leave(key);
      if (!g.group.size) tx.drop();
      return true;
    })
  );
  return !!left;
}

const keyOf = (ctx: JellyfinRequestContext) =>
  clientKey(ctx.userId, ctx.client.deviceId);

function memberOf(ctx: JellyfinRequestContext) {
  return {
    id: keyOf(ctx),
    name: ctx.persona?.name ?? accountName(ctx.userData),
    ping: 0,
    buffering: false,
    ignoreWait: false,
  };
}

function visibleTo(g: Group, ctx: JellyfinRequestContext): boolean {
  const { home } = g;
  if (home.hidden || ctx.persona?.hidden) return home.userId === ctx.userId;
  return appConfig.party.scope === 'instance' || home.uuid === ctx.uuid;
}

const guid = (value: unknown): string | null => {
  if (typeof value !== 'string' || !isGuidLike(value)) return null;
  return hyphenless(value).toLowerCase();
};

function itemsOf(value: unknown): QueueItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_QUEUE)
    .map(guid)
    .filter((id): id is string => !!id)
    .map((ref) => ({ ref, runtimeMs: 0 }));
}

const numberOf = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const msOf = (value: unknown) => numberOf(value) / 10_000;
const dateOf = (value: unknown) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : Date.now();
};

const REPEAT = ['RepeatOne', 'RepeatAll', 'RepeatNone'] as const;
const SHUFFLE = ['Sorted', 'Shuffle'] as const;
const pick = <T extends string>(list: readonly T[], value: unknown, or: T) =>
  list.includes(value as T) ? (value as T) : or;

/** The request a SyncPlay route stands for, from its body. */
function requestFor(action: string, req: Request): GroupRequest | null {
  const field = (name: string) => bodyField(req, name);
  switch (action) {
    case 'setnewqueue':
      return {
        type: 'Play',
        items: itemsOf(field('PlayingQueue')),
        index: numberOf(field('PlayingItemPosition')),
        startMs: msOf(field('StartPositionTicks')),
      };
    case 'setplaylistitem':
      return {
        type: 'SetPlaylistItem',
        playlistItemId: guid(field('PlaylistItemId')) ?? '',
      };
    case 'removefromplaylist': {
      const ids = field('PlaylistItemIds');
      return {
        type: 'RemoveFromPlaylist',
        playlistItemIds: Array.isArray(ids)
          ? ids.map(guid).filter((id): id is string => !!id)
          : [],
        clearPlaylist: field('ClearPlaylist') === true,
        clearPlayingItem: field('ClearPlayingItem') === true,
      };
    }
    case 'moveplaylistitem':
      return {
        type: 'MovePlaylistItem',
        playlistItemId: guid(field('PlaylistItemId')) ?? '',
        newIndex: numberOf(field('NewIndex')),
      };
    case 'queue':
      return {
        type: 'Queue',
        items: itemsOf(field('ItemIds')),
        mode: field('Mode') === 'QueueNext' ? 'QueueNext' : 'Queue',
      };
    case 'unpause':
      return { type: 'Unpause' };
    case 'pause':
      return { type: 'Pause' };
    case 'stop':
      return { type: 'Stop' };
    case 'seek':
      return { type: 'Seek', positionMs: msOf(field('PositionTicks')) };
    case 'buffering':
    case 'ready':
      return {
        type: action === 'ready' ? 'Ready' : 'Buffer',
        when: dateOf(field('When')),
        positionMs: msOf(field('PositionTicks')),
        isPlaying: field('IsPlaying') === true,
        playlistItemId: guid(field('PlaylistItemId')) ?? '',
      };
    case 'setignorewait':
      return { type: 'IgnoreWait', ignoreWait: field('IgnoreWait') === true };
    case 'nextitem':
    case 'previousitem':
      return {
        type: action === 'nextitem' ? 'NextItem' : 'PreviousItem',
        playlistItemId: guid(field('PlaylistItemId')) ?? '',
      };
    case 'setrepeatmode':
      return {
        type: 'SetRepeatMode',
        mode: pick(REPEAT, field('Mode'), 'RepeatNone'),
      };
    case 'setshufflemode':
      return {
        type: 'SetShuffleMode',
        mode: pick(SHUFFLE, field('Mode'), 'Sorted'),
      };
    case 'ping':
      return { type: 'Ping', ping: numberOf(field('Ping')) };
    default:
      return null;
  }
}

/** What the client was playing, which a group it starts takes over. */
async function playingOf(
  ctx: JellyfinRequestContext
): Promise<PlayingOnCreate | undefined> {
  const row = await WatchSessionRepository.get(
    ctx.watch,
    sessionKeyFor(ctx.client)
  ).catch(() => null);
  if (!row || row.endedAt != null) return undefined;
  const age = Date.now() - row.lastCheckinAt;
  if (age > PLAYING_FRESH_MS) return undefined;
  return {
    items: [
      {
        ref: encodeItemId(descriptorForWatchRow(row)),
        runtimeMs: row.durationMs,
      },
    ],
    index: 0,
    positionMs: row.positionMs + (row.paused ? 0 : age),
    paused: row.paused,
  };
}

const router: Router = Router({ mergeParams: true });

router.get(
  '/GetUtcTime',
  jfOptional((_req, res) => {
    const received = new Date().toISOString();
    res.json({
      RequestReceptionTime: received,
      ResponseTransmissionTime: new Date().toISOString(),
    });
  })
);

router.get(
  '/SyncPlay/List',
  jf(async (_req, res, ctx) => {
    const ids = await groups.tagged('groups');
    const found = await Promise.all(ids.map((id) => groups.get(id)));
    res.json(
      found
        .filter((g): g is Group => !!g && visibleTo(g, ctx))
        .map((g) => groupInfo(g.group))
    );
  })
);

router.post(
  '/SyncPlay/New',
  jf(async (req, res, ctx) => {
    const raw = bodyField(req, 'GroupName');
    const member = memberOf(ctx);
    const name =
      (typeof raw === 'string' && raw.trim().slice(0, MAX_NAME)) ||
      `${member.name}'s group`;
    // A client is in one group at most.
    await leave(member.id);
    const playing = await playingOf(ctx);
    const id = syncId();
    let made: SyncGroup | undefined;
    const created = await groups.create(
      id,
      (tx) => {
        const g: Group = {
          group: new SyncGroup(name, deliver, undefined, id),
          home: {
            uuid: ctx.uuid,
            userId: ctx.userId,
            hidden: !!ctx.persona?.hidden,
          },
          away: {},
        };
        changing(g, tx, () => g.group.create(member, playing));
        made = g.group;
        return g;
      },
      appConfig.party.maxParties
    );
    if (created !== 'ok' || !made) {
      res.status(503).json({ Message: 'Too many groups on this server' });
      return;
    }
    logger.debug({ group: id, uuid: ctx.uuid }, 'syncplay group created');
    res.json(groupInfo(made));
  })
);

router.post(
  '/SyncPlay/Join',
  jf(async (req, res, ctx) => {
    const id = guid(bodyField(req, 'GroupId'));
    const found = id ? await groups.get(id) : undefined;
    const member = memberOf(ctx);
    let joined = false;
    if (id && found && visibleTo(found, ctx)) {
      if ((await groups.find(member.id)) !== id) await leave(member.id);
      joined = !!(await groups.update(id, (g, tx) =>
        changing(g, tx, () => {
          delete g.away[member.id];
          g.group.join(member);
          return true;
        })
      ));
    }
    if (!joined) notice(member.id, 'GroupDoesNotExist');
    res.status(204).end();
  })
);

router.post(
  '/SyncPlay/Leave',
  jf(async (_req, res, ctx) => {
    if (!(await leave(keyOf(ctx)))) notice(keyOf(ctx), 'NotInGroup');
    res.status(204).end();
  })
);

router.get(
  '/SyncPlay/:groupId',
  jf(async (req, res, ctx) => {
    const id = guid(param(req, 'groupId'));
    const found = id ? await groups.get(id) : undefined;
    if (!found || !visibleTo(found, ctx)) {
      res.status(404).json({ Message: 'Group not found' });
      return;
    }
    res.json(groupInfo(found.group));
  })
);

router.post(
  '/SyncPlay/:action',
  jf(async (req: Request, res: Response, ctx) => {
    const request = requestFor(param(req, 'action').toLowerCase(), req);
    if (!request) {
      res.status(404).json({ Message: 'Unknown SyncPlay request' });
      return;
    }
    const key = keyOf(ctx);
    const id = await groups.find(key);
    const handled =
      id &&
      (await groups.update(id, (g, tx) => {
        if (!g.group.member(key)) return false;
        if (request.type === 'Ping' && !g.group.pingMoved(key, request.ping))
          return true;
        const capped = withinQueue(request, g.group.queue.size, MAX_QUEUE);
        changing(g, tx, () => g.group.handle(key, capped));
        return true;
      }));
    if (!handled) notice(key, 'NotInGroup');
    res.status(204).end();
  })
);

/* Signing out ends the client's place in a group, as its session ends. */
router.post('/Sessions/Logout', (req, _res, next) => {
  if (!req.jf) return next();
  void leave(keyOf(req.jf))
    .catch(failed)
    .finally(() => next());
});

export default router;
