import { Router, type Request, type Response } from 'express';
import {
  config as appConfig,
  createLogger,
  descriptorForWatchRow,
  encodeItemId,
  GroupHub,
  hyphenless,
  isGuidLike,
  msToTicks,
  sessionKeyFor,
  WatchSessionRepository,
  type GroupMessage,
  type GroupRequest,
  type PlayingOnCreate,
  type QueueItem,
  type QueueSnapshot,
  type SyncGroup,
} from '@aiostreams/core';
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
  clientOnline,
  onClientOffline,
  sendToClient,
} from './session-sockets.js';

/*
 * Jellyfin's SyncPlay for Jellyfin apps, over the shared group engine. Members
 * are clients (a user on a device), which hear the group on their session socket.
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

const homes = new WeakMap<SyncGroup, Home>();
const graces = new Map<string, ReturnType<typeof setTimeout>>();

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

function deliver(
  group: SyncGroup,
  to: readonly string[],
  message: GroupMessage
): void {
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
  for (const key of to) sendToClient(key, type, data);
}

const hub = new GroupHub(deliver);

onClientOffline((key) => {
  if (!hub.groupOf(key) || graces.has(key)) return;
  graces.set(
    key,
    setTimeout(() => {
      graces.delete(key);
      if (!clientOnline(key)) hub.leave(key);
    }, GRACE_MS).unref()
  );
});

function notice(key: string, type: string) {
  sendToClient(key, 'SyncPlayGroupUpdate', {
    GroupId: '',
    Type: type,
    Data: '',
  });
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

function visibleTo(group: SyncGroup, ctx: JellyfinRequestContext): boolean {
  const home = homes.get(group);
  if (!home) return false;
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
  jf((_req, res, ctx) => {
    res.json(
      hub
        .list()
        .filter((group) => visibleTo(group, ctx))
        .map(groupInfo)
    );
  })
);

router.post(
  '/SyncPlay/New',
  jf(async (req, res, ctx) => {
    if (GroupHub.total() >= appConfig.party.maxParties) {
      res.status(503).json({ Message: 'Too many groups on this server' });
      return;
    }
    const raw = bodyField(req, 'GroupName');
    const name =
      (typeof raw === 'string' && raw.trim().slice(0, MAX_NAME)) ||
      `${memberOf(ctx).name}'s group`;
    const member = memberOf(ctx);
    const group = hub.create(name, member, {
      playing: await playingOf(ctx),
    });
    homes.set(group, {
      uuid: ctx.uuid,
      userId: ctx.userId,
      hidden: !!ctx.persona?.hidden,
    });
    logger.debug({ group: group.id, uuid: ctx.uuid }, 'syncplay group created');
    res.json(groupInfo(group));
  })
);

router.post(
  '/SyncPlay/Join',
  jf((req, res, ctx) => {
    const id = guid(bodyField(req, 'GroupId'));
    const group = id ? hub.get(id) : undefined;
    if (!group || !visibleTo(group, ctx))
      notice(keyOf(ctx), 'GroupDoesNotExist');
    else hub.join(group.id, memberOf(ctx));
    res.status(204).end();
  })
);

router.post(
  '/SyncPlay/Leave',
  jf((_req, res, ctx) => {
    if (!hub.leave(keyOf(ctx))) notice(keyOf(ctx), 'NotInGroup');
    res.status(204).end();
  })
);

router.get(
  '/SyncPlay/:groupId',
  jf((req, res, ctx) => {
    const id = guid(param(req, 'groupId'));
    const group = id ? hub.get(id) : undefined;
    if (!group || !visibleTo(group, ctx)) {
      res.status(404).json({ Message: 'Group not found' });
      return;
    }
    res.json(groupInfo(group));
  })
);

router.post(
  '/SyncPlay/:action',
  jf((req: Request, res: Response, ctx) => {
    const request = requestFor(param(req, 'action').toLowerCase(), req);
    if (!request) {
      res.status(404).json({ Message: 'Unknown SyncPlay request' });
      return;
    }
    const key = keyOf(ctx);
    if (!hub.request(key, request)) notice(key, 'NotInGroup');
    res.status(204).end();
  })
);

/* Signing out ends the client's place in a group, as its session ends. */
router.post('/Sessions/Logout', (req, _res, next) => {
  if (req.jf) hub.leave(keyOf(req.jf));
  next();
});

export default router;
