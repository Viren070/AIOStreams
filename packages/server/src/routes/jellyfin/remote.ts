import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  createLogger,
  hyphenless,
  isGuidLike,
  sharedBackend,
  SharedTx,
  type ClientInfo,
  type SharedMessage,
} from '@aiostreams/core';
import {
  bodyField,
  jf,
  jfOptional,
  param,
  qb,
  qlist,
  qs,
  type JellyfinRequestContext,
} from './context.js';
import {
  clientKey,
  frame,
  onClientOffline,
  onClientOnline,
  sendFrameToClient,
  sessionIdOf,
} from './session-sockets.js';

/*
 * Jellyfin's remote control. A client that posts its capabilities can be sent
 * commands on its session socket, on whichever replica holds it.
 */

const logger = createLogger('jellyfin');

/** Clients post their capabilities once, so they outlast a reconnect. */
const KEEP_MS = 24 * 60 * 60_000;
/** For one whose socket never opened, so posts alone can't fill the store. */
const PENDING_MS = 2 * 60_000;
/** A socket just opened on another replica can take a moment to show. */
const RECHECK_MS = 5_000;
const MAX_PER_CONFIG = 32;
const MAX_DEVICES = 100_000;
const MAX_LIST = 64;
const MAX_TEXT = 128;

export interface RemoteDevice {
  uuid: string;
  userId: string;
  /** Empty for the primary user. */
  persona: string;
  client: ClientInfo;
  media: string[];
  commands: string[];
  mediaControl: boolean;
  /** When its last socket closed; null while one is open. */
  awaySince: number | null;
  /** Whether its socket has ever been open. */
  seen: boolean;
}

const keepOf = (d: RemoteDevice) => (d.seen ? KEEP_MS : PENDING_MS);

const store = sharedBackend();
const devices = store.records<RemoteDevice>({
  name: 'remote',
  ownCap: true,
  save: (d) => d,
  load: (saved: RemoteDevice) => saved,
  due: (d) => (d.awaySince === null ? null : d.awaySince + keepOf(d)),
  tags: (d) => [d.uuid],
  refs: (d) => [keyOf(d)],
  // Commands go out by broadcast, so no replica follows the records.
  replicas: () => [],
  receive,
  lapse,
  orphaned,
});

const keyOf = (d: RemoteDevice) => clientKey(d.userId, d.client.deviceId);

function receive(_id: string, messages: readonly SharedMessage[]): void {
  for (const { to, data } of messages)
    for (const key of to) sendFrameToClient(key, data);
}

async function lapse(id: string): Promise<void> {
  const found = await devices.get(id);
  if (!found) return;
  const back = await store.presence.online(keyOf(found));
  await devices.update(id, (d, tx) => {
    if (back) {
      d.awaySince = null;
      d.seen = true;
    } else if (d.awaySince !== null && d.awaySince + keepOf(d) <= Date.now())
      tx.drop();
  });
}

async function orphaned(replica: string): Promise<void> {
  for (const key of await store.presence.of(replica)) await went(key);
}

async function went(key: string): Promise<void> {
  const id = await devices.find(key);
  if (!id || (await store.presence.online(key))) return;
  await devices.update(id, (d) => {
    d.awaySince ??= Date.now();
  });
}

async function returned(key: string): Promise<void> {
  const id = await devices.find(key);
  if (!id) return;
  await devices.update(id, (d) => {
    d.awaySince = null;
    d.seen = true;
  });
}

const failed = (err: unknown) =>
  logger.warn(
    { err: err instanceof Error ? err.message : err },
    'remote control presence failed'
  );

onClientOffline((key) => void went(key).catch(failed));
onClientOnline((key) => void returned(key).catch(failed));

/** The primary user controls every user's devices, as an API key does. */
function controls(ctx: JellyfinRequestContext, d: RemoteDevice): boolean {
  if (d.uuid !== ctx.uuid.toLowerCase()) return false;
  return !!ctx.apiKey || !ctx.persona || d.userId === ctx.userId;
}

/** Devices with a socket open that the caller may send commands to. */
export async function controllableDevices(
  ctx: JellyfinRequestContext
): Promise<RemoteDevice[]> {
  const ids = await devices.tagged(ctx.uuid.toLowerCase());
  const found = await Promise.all(ids.map((id) => devices.get(id)));
  return found.filter(
    (d): d is RemoteDevice => !!d && d.awaySince === null && controls(ctx, d)
  );
}

function listOf(req: Request, name: string): string[] {
  const sent = bodyField(req, name);
  const list = Array.isArray(sent)
    ? sent.filter((v): v is string => typeof v === 'string')
    : qlist(req, name);
  return list.slice(0, MAX_LIST).map((v) => v.slice(0, MAX_LIST));
}

/** Makes room in a full configuration by dropping its longest-gone device. */
async function roomFor(uuid: string): Promise<boolean> {
  const ids = await devices.tagged(uuid);
  if (ids.length < MAX_PER_CONFIG) return true;
  const found = await Promise.all(ids.map((id) => devices.get(id)));
  let oldest: { id: string; at: number } | undefined;
  found.forEach((d, i) => {
    if (d?.awaySince != null && (!oldest || d.awaySince < oldest.at))
      oldest = { id: ids[i], at: d.awaySince };
  });
  if (!oldest) return false;
  await devices.update(oldest.id, (_d, tx) => tx.drop());
  return true;
}

async function register(
  req: Request,
  ctx: JellyfinRequestContext
): Promise<void> {
  const { client, userId } = ctx;
  const fields = [client.name, client.device, client.deviceId, client.version];
  if (!client.deviceId || fields.some((v) => v.length > MAX_TEXT)) return;
  const uuid = ctx.uuid.toLowerCase();
  const key = clientKey(userId, client.deviceId);
  const id = sessionIdOf(client, userId);
  const online = await store.presence.online(key);
  const sent: RemoteDevice = {
    uuid,
    userId,
    persona: ctx.persona?.id ?? '',
    client,
    media: listOf(req, 'PlayableMediaTypes'),
    commands: listOf(req, 'SupportedCommands'),
    mediaControl:
      bodyField(req, 'SupportsMediaControl') === true ||
      qb(req, 'SupportsMediaControl') === true,
    awaySince: online ? null : Date.now(),
    seen: online,
  };
  // A device found under another client name is the same device renamed.
  const previous = await devices.find(key);
  if (previous && previous !== id)
    await devices.update(previous, (_d, tx) => tx.drop());
  const set = (d: RemoteDevice) =>
    void Object.assign(d, sent, { seen: d.seen || online });
  if (!(await devices.update(id, (d) => (set(d), true)))) {
    if (!(await roomFor(uuid))) return;
    const made = await devices.create(id, () => ({ ...sent }), MAX_DEVICES);
    if (made === 'exists') await devices.update(id, set);
  }
  if (!online)
    setTimeout(() => void recheck(key).catch(failed), RECHECK_MS).unref();
}

async function recheck(key: string): Promise<void> {
  if (await store.presence.online(key)) await returned(key);
}

async function forget(ctx: JellyfinRequestContext): Promise<void> {
  const id = sessionIdOf(ctx.client, ctx.userId);
  await devices.update(id, (_d, tx) => tx.drop());
}

async function target(
  req: Request,
  res: Response,
  ctx: JellyfinRequestContext
): Promise<RemoteDevice | null> {
  const device = await devices.get(hyphenless(param(req, 'sessionId')));
  if (device && device.awaySince === null && controls(ctx, device))
    return device;
  res.status(404).json({ Message: 'Session not found' });
  return null;
}

function send(device: RemoteDevice, type: string, data: unknown): void {
  const tx = new SharedTx();
  tx.send([keyOf(device)], Buffer.from(frame(type, data)));
  devices.broadcast(tx);
}

function numberOf(req: Request, name: string): number | undefined {
  const v = qs(req, name);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

const PLAYSTATE = [
  'Stop',
  'Pause',
  'Unpause',
  'NextTrack',
  'PreviousTrack',
  'Seek',
  'Rewind',
  'FastForward',
  'PlayPause',
];

function stringArguments(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw).slice(0, MAX_LIST))
    if (v != null) out[k] = String(v);
  return out;
}

const router: Router = Router({ mergeParams: true });

router.post(
  ['/Sessions/Capabilities', '/Sessions/Capabilities/Full'],
  jfOptional(async (req, res, ctx) => {
    if (ctx && !ctx.apiKey) await register(req, ctx);
    res.status(204).end();
  })
);

router.post('/Sessions/Logout', (req, _res, next) => {
  if (!req.jf) return next();
  void forget(req.jf)
    .catch(failed)
    .finally(() => next());
});

/* Session ids are hex; anything else is one of the caller's own routes. */
router.use(
  '/Sessions/:sessionId',
  (req: Request, _res: Response, next: NextFunction) =>
    isGuidLike(param(req, 'sessionId')) ? next() : next('router')
);

router.post(
  '/Sessions/:sessionId/Viewing',
  jf(async (req, res, ctx) => {
    const device = await target(req, res, ctx);
    if (!device) return;
    send(device, 'GeneralCommand', {
      Name: 'DisplayContent',
      ControllingUserId: ctx.userId,
      Arguments: {
        ItemId: hyphenless(qs(req, 'itemId') ?? ''),
        ItemName: qs(req, 'itemName') ?? '',
        ItemType: qs(req, 'itemType') ?? '',
      },
    });
    res.status(204).end();
  })
);

router.post(
  '/Sessions/:sessionId/Playing',
  jf(async (req, res, ctx) => {
    const ids = qlist(req, 'itemIds').map(hyphenless).slice(0, MAX_LIST);
    if (!ids.length) {
      res.status(400).json({ Message: 'itemIds is required' });
      return;
    }
    const device = await target(req, res, ctx);
    if (!device) return;
    const source = qs(req, 'mediaSourceId');
    send(device, 'Play', {
      ItemIds: ids,
      PlayCommand: qs(req, 'playCommand') ?? 'PlayNow',
      StartPositionTicks: numberOf(req, 'startPositionTicks'),
      MediaSourceId: source ? hyphenless(source) : undefined,
      AudioStreamIndex: numberOf(req, 'audioStreamIndex'),
      SubtitleStreamIndex: numberOf(req, 'subtitleStreamIndex'),
      StartIndex: numberOf(req, 'startIndex'),
      ControllingUserId: ctx.userId,
    });
    res.status(204).end();
  })
);

router.post(
  '/Sessions/:sessionId/Playing/:command',
  jf(async (req, res, ctx) => {
    const wanted = param(req, 'command').toLowerCase();
    const command = PLAYSTATE.find((c) => c.toLowerCase() === wanted);
    if (!command) {
      res.status(400).json({ Message: 'Unknown playstate command' });
      return;
    }
    const device = await target(req, res, ctx);
    if (!device) return;
    send(device, 'Playstate', {
      Command: command,
      SeekPositionTicks: numberOf(req, 'seekPositionTicks'),
      ControllingUserId: ctx.userId,
    });
    res.status(204).end();
  })
);

router.post(
  '/Sessions/:sessionId/Command',
  jf(async (req, res, ctx) => {
    const name = bodyField(req, 'Name');
    if (typeof name !== 'string' || !name) {
      res.status(400).json({ Message: 'Name is required' });
      return;
    }
    const device = await target(req, res, ctx);
    if (!device) return;
    send(device, 'GeneralCommand', {
      Name: name,
      ControllingUserId: ctx.userId,
      Arguments: stringArguments(bodyField(req, 'Arguments')),
    });
    res.status(204).end();
  })
);

router.post(
  ['/Sessions/:sessionId/Command/:name', '/Sessions/:sessionId/System/:name'],
  jf(async (req, res, ctx) => {
    const device = await target(req, res, ctx);
    if (!device) return;
    send(device, 'GeneralCommand', {
      Name: param(req, 'name'),
      ControllingUserId: ctx.userId,
      Arguments: {},
    });
    res.status(204).end();
  })
);

router.post(
  '/Sessions/:sessionId/Message',
  jf(async (req, res, ctx) => {
    const device = await target(req, res, ctx);
    if (!device) return;
    const timeout = bodyField(req, 'TimeoutMs');
    send(device, 'GeneralCommand', {
      Name: 'DisplayMessage',
      ControllingUserId: ctx.userId,
      Arguments: stringArguments({
        Header: bodyField(req, 'Header'),
        Text: bodyField(req, 'Text'),
        TimeoutMs: typeof timeout === 'number' ? timeout : undefined,
      }),
    });
    res.status(204).end();
  })
);

export default router;
