import { Router, type Request, type Response } from 'express';
import {
  config as appConfig,
  createLogger,
  encryptString,
  getSimpleTextHash,
  isConfigUuid,
  liveCatalogs,
  mintToken,
  personaUserId,
  quickConnectConsume,
  resolveConfigAlias,
  serverId as instanceServerId,
  sessionKeyFor,
  msToTicks,
  WatchSessionRepository,
  buildMediaStreams,
  resolveByItem,
  resolveByPlaySession,
  subtitleFormatFor,
  type ClientInfo,
  type JellyfinMediaStream,
  isOwner,
  ownerOf,
  profileById,
  profilesOf,
  type Profile,
  type UserData,
  type WatchSessionRow,
} from '@aiostreams/core';
import {
  jf,
  jfOptional,
  param,
  profileByName,
  PIN_REQUIRED,
  lockTag,
  userUnlocks,
  watchScopeOf,
  qs,
  resolveConfig,
  resolvePickerAlias,
  type JellyfinRequestContext,
} from './context.js';
import { subtitleUrlFor, summaryItem } from './items.js';
import {
  everyoneUserId,
  prefsScope,
  saveUserConfiguration,
  storedUserConfiguration,
  userConfiguration,
} from './preferences.js';
import { pickSource } from './playback.js';
import { serverName } from './system.js';
import { sessionIdOf } from './session-sockets.js';
import { controllableDevices, type RemoteDevice } from './remote.js';

const logger = createLogger('jellyfin');
const router: Router = Router({ mergeParams: true });

export function userPolicy(
  opts: { admin?: boolean; hidden?: boolean; forKey?: boolean } = {}
) {
  return {
    IsAdministrator: opts.admin ?? false,
    IsHidden: opts.hidden ?? false,
    EnableCollectionManagement: false,
    EnableSubtitleManagement: false,
    EnableLyricManagement: false,
    IsDisabled: false,
    BlockedTags: [],
    AllowedTags: [],
    EnableUserPreferenceAccess: true,
    AccessSchedules: [],
    BlockUnratedItems: [],
    EnableRemoteControlOfOtherUsers: false,
    EnableSharedDeviceControl: false,
    EnableRemoteAccess: true,
    EnableLiveTvManagement: false,
    EnableLiveTvAccess: false,
    EnableMediaPlayback: true,
    EnableAudioPlaybackTranscoding: false,
    EnableVideoPlaybackTranscoding: false,
    EnablePlaybackRemuxing: false,
    ForceRemoteSourceTranscoding: false,
    EnableContentDeletion: false,
    EnableContentDeletionFromFolders: [],
    EnableContentDownloading: true,
    EnableSyncTranscoding: false,
    EnableMediaConversion: false,
    EnabledDevices: [],
    EnableAllDevices: true,
    EnabledChannels: [],
    EnableAllChannels: true,
    EnabledFolders: [],
    EnableAllFolders: true,
    InvalidLoginAttemptCount: 0,
    LoginAttemptsBeforeLockout: -1,
    MaxActiveSessions: 0,
    EnablePublicSharing: false,
    BlockedMediaFolders: [],
    BlockedChannels: [],
    RemoteClientBitrateLimit: 0,
    AuthenticationProviderId:
      'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
    PasswordResetProviderId:
      'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
    // A key has no session to join a group with.
    SyncPlayAccess: opts.forKey ? 'None' : 'CreateAndJoinGroups',
  };
}

type Faced = Pick<UserData, 'addonName'>;

export function profileName(userData: Faced, profile: Profile): string {
  return profile.name || userData.addonName || serverName();
}

/** Changes whenever the picture would, so a client drops its cached copy. */
function avatarTag(avatar: string | undefined): string | undefined {
  return avatar ? getSimpleTextHash(avatar).slice(0, 16) : undefined;
}

/** `forKey` rows make the owner the administrator an API key acts as. */
export function userDto(
  uuid: string,
  userData: Faced,
  profile: Profile,
  opts: { forKey?: boolean } = {}
) {
  const now = new Date().toISOString();
  const tag = avatarTag(profile.avatar);
  return {
    Name: profileName(userData, profile),
    ServerId: instanceServerId(),
    ServerName: serverName(),
    Id: personaUserId(uuid, profile.id),
    ...(tag ? { PrimaryImageTag: tag } : {}),
    HasPassword: true,
    HasConfiguredPassword: true,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: !profile.lock,
    LastLoginDate: now,
    LastActivityDate: now,
    Configuration: userConfiguration(),
    aiostreams: {
      profile: profile.id,
      owner: isOwner(profile),
      everyone: everyoneUserId(uuid),
    },
    Policy: opts.forKey
      ? userPolicy({
          admin: isOwner(profile),
          hidden: profile.hidden,
          forKey: true,
        })
      : userPolicy(),
  };
}

/** Clients show Live TV to a user whose addons have a live catalog. */
async function withLiveTv<T extends { Policy: object }>(
  ctx: JellyfinRequestContext,
  user: T
): Promise<T> {
  const live = await ctx
    .engine()
    .then((engine) => liveCatalogs(engine).length > 0)
    .catch(() => false);
  return { ...user, Policy: { ...user.Policy, EnableLiveTvAccess: live } };
}

export function sessionInfo(
  uuid: string,
  userData: Faced,
  profile: Profile,
  client: ClientInfo,
  remoteIp: string | undefined
) {
  const now = new Date().toISOString();
  const userId = personaUserId(uuid, profile.id);
  return {
    PlayState: {
      CanSeek: true,
      IsPaused: false,
      IsMuted: false,
      RepeatMode: 'RepeatNone',
      PlaybackOrder: 'Default',
    },
    AdditionalUsers: [],
    Capabilities: {
      PlayableMediaTypes: ['Video'],
      SupportedCommands: [] as string[],
      SupportsMediaControl: false,
      SupportsPersistentIdentifier: false,
    },
    RemoteEndPoint: remoteIp ?? '',
    PlayableMediaTypes: ['Video'],
    Id: sessionIdOf(client, userId),
    UserId: userId,
    UserName: profileName(userData, profile),
    Client: client.name,
    LastActivityDate: now,
    LastPlaybackCheckIn: new Date(0).toISOString(),
    DeviceName: client.device,
    DeviceId: client.deviceId,
    ApplicationVersion: client.version,
    IsActive: true,
    SupportsMediaControl: false,
    SupportsRemoteControl: false,
    NowPlayingQueue: [],
    HasCustomDeviceName: false,
    ServerId: instanceServerId(),
    SupportedCommands: [] as string[],
  };
}

function clientOf(req: Request): ClientInfo {
  return (
    req.jfClient ?? {
      name: 'Unknown',
      device: 'Unknown',
      deviceId: 'unknown',
      version: '0',
    }
  );
}

export async function authenticationResult(
  req: Request,
  uuid: string,
  encryptedPassword: string,
  userData: UserData,
  profile: Profile,
  opts: { provedPassword?: boolean } = {}
) {
  const client = clientOf(req);
  return {
    User: {
      ...userDto(uuid, userData, profile),
      Configuration: await storedUserConfiguration(watchScopeOf(uuid, profile)),
    },
    SessionInfo: sessionInfo(uuid, userData, profile, client, req.userIp),
    AccessToken: mintToken({
      u: uuid,
      p: encryptedPassword,
      d: client.deviceId,
      k: profile.id || undefined,
      l: lockTag(profile) || undefined,
      ...(!isOwner(profile) && opts.provedPassword ? { o: 1 as const } : {}),
    }),
    ServerId: instanceServerId(),
  };
}

/** A hidden profile sees only itself; a hidden owner is only off the picker. */
export function listedFor(caller: Profile, profile: Profile): boolean {
  if (caller.id === profile.id) return true;
  return (isOwner(caller) || !caller.hidden) && !profile.hidden;
}

/** The owner first; an API key lists every profile it can act as. */
function allUsers(
  uuid: string,
  userData: UserData,
  caller: Profile,
  opts: { forKey?: boolean } = {}
) {
  return profilesOf(userData)
    .filter((p) => (opts.forKey ? isOwner(p) || !p.lock : listedFor(caller, p)))
    .map((p) => userDto(uuid, userData, p, opts));
}

/** A personal address lists its own profile, any other picker everyone not hidden. */
export function pickerListed(
  mount: PickerMount,
  userData: UserData
): Profile[] {
  return profilesOf(userData).filter((p) =>
    mount.persona
      ? p.id === mount.persona && !isOwner(p) && p.hidden
      : !p.hidden
  );
}

/**
 * The profile a sign-in named. The owner answers to its own name and to an
 * empty one; anything else must be another profile, since a picker posts back
 * the exact name it was shown.
 */
function resolveSignIn(userData: UserData, name: string): Profile | null {
  if (!name) return ownerOf(userData);
  const named = profileByName(userData, name);
  if (named) return named;
  const owner = ownerOf(userData);
  return name.trim().toLowerCase() ===
    profileName(userData, owner).toLowerCase()
    ? owner
    : null;
}

router.get(
  '/Users/Public',
  jfOptional(async (req, res) => {
    const mount = req.jfMount;
    const userData = mount
      ? await resolveConfig(mount.uuid, mount.encryptedPassword)
      : null;
    // Without a configuration to list for, an empty list is what makes a
    // client show the manual form that takes a uuid or alias.
    res.json(
      mount && userData
        ? pickerListed(mount, userData).map((p) =>
            userDto(mount.uuid, userData, p)
          )
        : []
    );
  })
);

/** `Pw` may be `<password>/<pin>`; the whole value is tried first, so a password holding a slash works. */
async function checkPassword(
  uuid: string,
  pw: string
): Promise<{ encryptedPassword: string; pin: string } | null> {
  const slash = pw.lastIndexOf('/');
  const candidates: [string, string][] = [[pw, '']];
  if (slash > 0) candidates.push([pw.slice(0, slash), pw.slice(slash + 1)]);
  for (const [password, pin] of candidates) {
    const enc = encryptString(password);
    if (!enc.success || !enc.data) throw new Error('Encryption failure');
    if (await resolveConfig(uuid, enc.data))
      return { encryptedPassword: enc.data, pin };
  }
  return null;
}

/** A bare user name, alias or the uuid on a picker address; `<uuid or alias>/<user>` elsewhere. */
function parseSignIn(
  username: string,
  mount: { uuid: string } | undefined
): { account: string; profile: string } | null {
  if (mount) {
    if (username.includes('/')) return null;
    return isConfigUuid(username)
      ? { account: username, profile: '' }
      : { account: mount.uuid, profile: username };
  }
  const slash = username.lastIndexOf('/');
  return slash < 0
    ? { account: username, profile: '' }
    : {
        account: username.slice(0, slash),
        profile: username.slice(slash + 1),
      };
}

type PickerMount = NonNullable<Request['jfMount']>;

interface PickerTarget {
  userData: UserData;
  profile: Profile;
}

/** A personal address takes only its own profile's name, or none. */
async function pickerTarget(
  mount: PickerMount,
  name: string
): Promise<PickerTarget | null> {
  const userData = await resolveConfig(mount.uuid, mount.encryptedPassword);
  if (!userData) return null;
  if (!mount.persona) {
    const profile = profileByName(userData, name);
    return profile ? { userData, profile } : null;
  }
  const profile = profileById(userData, mount.persona);
  if (!profile || isOwner(profile) || !profile.hidden) return null;
  const wanted = name.trim().toLowerCase();
  return !wanted ||
    wanted === profile.id ||
    wanted === profile.name?.trim().toLowerCase()
    ? { userData, profile }
    : null;
}

/** Shorter PINs are too easy to guess once the picker address has leaked. */
const PIN_ONLY_PATTERN = /^\d{6,12}$/;

/** The picker address's credential stands in for the password. */
async function pinOnlySignIn(
  mount: PickerMount,
  target: PickerTarget,
  pin: string
): Promise<boolean> {
  if (!appConfig.jellyfin.pinSignIn || !PIN_ONLY_PATTERN.test(pin)) {
    return false;
  }
  return !!target.profile.lock && userUnlocks(mount.uuid, target.profile, pin);
}

router.post(
  '/Users/AuthenticateByName',
  jfOptional(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = String(body.Username ?? body.username ?? '').trim();
    const pw = String(
      body.Pw ?? body.pw ?? body.Password ?? body.password ?? ''
    );
    const mount = req.jfMount;

    const named = parseSignIn(username, mount);
    if (!named) {
      res.status(401).json({ Message: 'Invalid username or password' });
      return;
    }
    const { account, profile: wanted } = named;
    if (!account) {
      res.status(401).json({
        Message: 'Username (configuration UUID or alias) is required',
      });
      return;
    }
    // An alias only stands in for the uuid; the password is still asked for.
    const uuid = isConfigUuid(account)
      ? account
      : (await resolveConfigAlias(account))?.uuid;
    if (!uuid || (mount && uuid.toLowerCase() !== mount.uuid.toLowerCase())) {
      res.status(401).json({ Message: 'Invalid username or password' });
      return;
    }
    const own = mount?.persona ? await pickerTarget(mount, wanted) : null;
    if (mount?.persona && !own) {
      res.status(401).json({ Message: 'Invalid username or password' });
      return;
    }
    const proven = await checkPassword(uuid, pw);
    if (!proven) {
      const byPin =
        own ?? (mount && wanted ? await pickerTarget(mount, wanted) : null);
      if (!mount || !byPin || !(await pinOnlySignIn(mount, byPin, pw))) {
        res.status(401).json({ Message: 'Invalid username or password' });
        return;
      }
      const client = clientOf(req);
      logger.info(
        {
          uuid: mount.uuid,
          profile: byPin.profile.id,
          client: client.name,
          device: client.device,
        },
        'jellyfin client authenticated with a pin'
      );
      res.json(
        await authenticationResult(
          req,
          mount.uuid,
          mount.encryptedPassword,
          byPin.userData,
          byPin.profile
        )
      );
      return;
    }
    const { encryptedPassword, pin } = proven;

    const userData = await resolveConfig(uuid, encryptedPassword);
    if (!userData) {
      res.status(401).json({ Message: 'Invalid username or password' });
      return;
    }
    // On a picker address the owner also answers to the alias, after the other profiles.
    const profile =
      own?.profile ??
      resolveSignIn(userData, wanted) ??
      (mount &&
      (await resolvePickerAlias(wanted))?.uuid.toLowerCase() ===
        uuid.toLowerCase()
        ? ownerOf(userData)
        : null);
    if (!profile) {
      res.status(401).json({ Message: 'Invalid username or password' });
      return;
    }
    if (!(await userUnlocks(uuid, profile, pin))) {
      res.status(401).json({ Message: PIN_REQUIRED });
      return;
    }
    const client = clientOf(req);
    logger.info(
      {
        uuid,
        profile: profile.id,
        client: client.name,
        device: client.device,
      },
      'jellyfin client authenticated'
    );
    res.json(
      await authenticationResult(
        req,
        uuid,
        encryptedPassword,
        userData,
        profile,
        {
          provedPassword: true,
        }
      )
    );
  })
);

router.post(
  '/Users/AuthenticateWithQuickConnect',
  jfOptional(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const secret = String(body.Secret ?? body.secret ?? '');
    const entry = secret ? await quickConnectConsume(secret) : null;
    if (!entry?.uuid || !entry.encryptedPassword) {
      res
        .status(401)
        .json({ Message: 'Quick Connect code has not been approved' });
      return;
    }
    const userData = await resolveConfig(entry.uuid, entry.encryptedPassword);
    if (!userData) {
      res.status(401).json({ Message: 'Configuration is no longer valid' });
      return;
    }
    const named = profileById(userData, entry.persona ?? '');
    if (!named) {
      logger.warn(
        { uuid: entry.uuid, profile: entry.persona },
        'quick connect profile no longer exists, signing in as the owner'
      );
    }
    const profile = named ?? ownerOf(userData);
    logger.info(
      {
        uuid: entry.uuid,
        profile: profile.id,
        client: entry.appName,
        device: entry.deviceName,
      },
      'quick connect sign-in'
    );
    res.json(
      await authenticationResult(
        req,
        entry.uuid,
        entry.encryptedPassword,
        userData,
        profile
      )
    );
  })
);

router.get(
  '/Users/Me',
  jf(async (_req, res, ctx) => {
    if (ctx.apiKey) {
      res.status(400).json({ Message: 'API keys have no user' });
      return;
    }
    res.json({
      ...(await withLiveTv(ctx, userDto(ctx.uuid, ctx.userData, ctx.profile))),
      Configuration: await storedUserConfiguration(ctx.watch),
    });
  })
);
router.get(
  '/Users',
  jf(async (_req, res, ctx) => {
    res.json(
      allUsers(ctx.uuid, ctx.userData, ctx.profile, { forKey: !!ctx.apiKey })
    );
  })
);
router.get(
  '/Users/:userId',
  jf(async (req, res, ctx) => {
    const wanted = param(req, 'userId').toLowerCase();
    const found = profilesOf(ctx.userData).find(
      (p) =>
        personaUserId(ctx.uuid, p.id) === wanted &&
        (isOwner(ctx.profile) || listedFor(ctx.profile, p))
    );
    const profile = found ?? ctx.profile;
    res.json({
      ...(await withLiveTv(
        ctx,
        userDto(ctx.uuid, ctx.userData, profile, { forKey: !!ctx.apiKey })
      )),
      Configuration: await storedUserConfiguration(
        watchScopeOf(ctx.uuid, profile)
      ),
    });
  })
);
router.get(
  '/Users/:userId/Configuration',
  jf(async (req, res, ctx) => {
    const scope = prefsScope(ctx, param(req, 'userId'), false)!;
    res.json(await storedUserConfiguration(scope));
  })
);
router.post(
  ['/Users/Configuration', '/Users/:userId/Configuration'],
  jf(async (req, res, ctx) => {
    const scope = prefsScope(ctx, param(req, 'userId'), true);
    if (!scope) {
      res.status(403).json({ Message: 'Only the owner sets these' });
      return;
    }
    await saveUserConfiguration(scope, req.body);
    res.status(204).end();
  })
);
router.post(
  [
    '/Users/Password',
    '/Users/:userId/Password',
    '/Users/:userId/Policy',
    '/Users/:userId/EasyPassword',
  ],
  jf(async (_req, res) => {
    res.status(204).end();
  })
);

const SESSIONS_LIMIT = 50;

/** The tracks of the version a session plays, while its memo lasts. */
async function playingStreams(
  ctx: JellyfinRequestContext,
  row: WatchSessionRow
): Promise<JellyfinMediaStream[] | undefined> {
  if (!row.playSessionId || !row.mediaSourceId) return undefined;
  const pointer = await resolveByPlaySession(row.playSessionId);
  if (!pointer?.scope || pointer.uuid !== ctx.uuid) return undefined;
  const memo = await resolveByItem(pointer.uuid, pointer.scope, pointer.itemId);
  if (!memo) return undefined;
  // The first version offered carries the item's id.
  const record = pickSource(
    memo,
    row.mediaSourceId === memo.itemId ? undefined : row.mediaSourceId
  );
  return record
    ? buildMediaStreams(record, {
        subtitleFormat: (ext) =>
          subtitleFormatFor(undefined, ctx.client.name, ext),
        subtitleUrl: subtitleUrlFor(memo.itemId, record.msid),
        playSessionId: memo.psid,
      })
    : undefined;
}

/** The caller's own session is the one this request is from, so it is active now. */
export async function sessionFromRow(
  ctx: JellyfinRequestContext,
  row: WatchSessionRow,
  user: Profile,
  own: { remoteIp: string | undefined } | null,
  opts: { streams?: boolean } = {}
) {
  const client: ClientInfo = own
    ? ctx.client
    : {
        name: row.client ?? '',
        device: row.deviceName ?? row.client ?? '',
        deviceId: row.deviceId ?? '',
        version: row.appVersion ?? '',
      };
  const session = sessionInfo(
    ctx.uuid,
    ctx.userData,
    user,
    client,
    own?.remoteIp
  );
  const checkIn = new Date(row.lastCheckinAt).toISOString();
  const playing = row.endedAt == null;
  const [item, streams] = playing
    ? await Promise.all([
        summaryItem(ctx, row),
        opts.streams ? playingStreams(ctx, row) : undefined,
      ])
    : [null, undefined];
  return {
    ...session,
    LastActivityDate: own ? session.LastActivityDate : checkIn,
    LastPlaybackCheckIn: checkIn,
    ...(playing
      ? {
          PlayState: {
            ...session.PlayState,
            PositionTicks: msToTicks(row.positionMs),
            IsPaused: row.paused,
            ...(row.mediaSourceId ? { MediaSourceId: row.mediaSourceId } : {}),
            ...(row.audioStreamIndex != null
              ? { AudioStreamIndex: row.audioStreamIndex }
              : {}),
            ...(row.subtitleStreamIndex != null
              ? { SubtitleStreamIndex: row.subtitleStreamIndex }
              : {}),
          },
        }
      : {}),
    ...(item
      ? { NowPlayingItem: streams ? { ...item, MediaStreams: streams } : item }
      : {}),
  };
}

function withRemote<S extends ReturnType<typeof sessionInfo>>(
  session: S,
  device: RemoteDevice
): S {
  return {
    ...session,
    Id: sessionIdOf(device.client, device.userId),
    Capabilities: {
      ...session.Capabilities,
      PlayableMediaTypes: device.media,
      SupportedCommands: device.commands,
      SupportsMediaControl: device.mediaControl,
    },
    PlayableMediaTypes: device.media,
    SupportedCommands: device.commands,
    SupportsMediaControl: device.mediaControl,
    SupportsRemoteControl: true,
  };
}

/** One read of each history for what the devices play. */
async function deviceSessions(
  ctx: JellyfinRequestContext,
  devices: RemoteDevice[]
) {
  const found = devices.flatMap((device) => {
    const user = profileById(ctx.userData, device.persona);
    if (!user) return [];
    const scope = watchScopeOf(ctx.uuid, user);
    const key = sessionKeyFor(device.client);
    return [{ device, user, scope, key, at: `${scope.persona}|${key}` }];
  });
  const scopes = new Map(found.map((f) => [f.scope.persona, f.scope]));
  const rows = new Map<string, WatchSessionRow>();
  await Promise.all(
    [...scopes.values()].map(async (scope) => {
      const keys = found
        .filter((f) => f.scope.persona === scope.persona)
        .map((f) => f.key);
      for (const row of await WatchSessionRepository.getMany(scope, keys))
        rows.set(`${scope.persona}|${row.sessionKey}`, row);
    })
  );
  return Promise.all(
    found.map(async ({ device, user, at }) => {
      const row = rows.get(at);
      return withRemote(
        row && row.endedAt == null
          ? await sessionFromRow(ctx, row, user, null, { streams: true })
          : sessionInfo(ctx.uuid, ctx.userData, user, device.client, undefined),
        device
      );
    })
  );
}

const sameDevice = (
  session: ReturnType<typeof sessionInfo>,
  device: RemoteDevice
) =>
  session.Client === device.client.name &&
  session.DeviceId.toLowerCase() === device.client.deviceId.toLowerCase();

/** The sessions on devices that take remote control, with what they take. */
export function withControls<S extends ReturnType<typeof sessionInfo>>(
  sessions: S[],
  devices: RemoteDevice[]
): S[] {
  return sessions.map((s) => {
    const device = devices.find((d) => sameDevice(s, d));
    return device ? withRemote(s, device) : s;
  });
}

async function withDevices<S extends ReturnType<typeof sessionInfo>>(
  ctx: JellyfinRequestContext,
  sessions: S[],
  devices: RemoteDevice[]
) {
  const listed = withControls(sessions, devices);
  const idle = await deviceSessions(
    ctx,
    devices.filter((d) => !sessions.some((s) => sameDevice(s, d)))
  );
  return [...listed, ...idle];
}

/** Not res.json: this route is never revalidated, so its ETag hash is wasted. */
const send = (res: Response, body: unknown) =>
  res.type('json').end(JSON.stringify(body));

/*
 * A non-administrator sees only their own sessions, so a user token gets the
 * clients of its history. An API key is the administrator and sees them all.
 */
router.get(
  '/Sessions',
  jf(async (req, res, ctx) => {
    const within = Number(qs(req, 'ActiveWithinSeconds'));
    const since = within > 0 ? Date.now() - within * 1000 : 0;
    const deviceId = qs(req, 'DeviceId')?.toLowerCase();
    const onDevice = (id: string | null) =>
      !deviceId || id?.toLowerCase() === deviceId;
    const devices = (await controllableDevices(ctx)).filter((d) =>
      onDevice(d.client.deviceId)
    );

    if (qs(req, 'ControllableByUserId')) {
      send(res, await deviceSessions(ctx, devices));
      return;
    }

    if (ctx.apiKey) {
      const rows = await WatchSessionRepository.listForUuid(
        ctx.uuid,
        SESSIONS_LIMIT
      );
      const sessions = [];
      for (const row of rows) {
        if (row.lastCheckinAt < since || !onDevice(row.deviceId)) continue;
        const user = profileById(ctx.userData, row.userPersona ?? row.persona);
        if (!user) continue;
        sessions.push(sessionFromRow(ctx, row, user, null));
      }
      send(res, await withDevices(ctx, await Promise.all(sessions), devices));
      return;
    }

    const ownKey = sessionKeyFor(ctx.client);
    const rows = await WatchSessionRepository.listForScope(
      ctx.watch,
      SESSIONS_LIMIT
    );
    const ownRow =
      rows.find((r) => r.sessionKey === ownKey) ??
      (rows.length === SESSIONS_LIMIT
        ? await WatchSessionRepository.get(ctx.watch, ownKey)
        : null);
    const others = rows.filter(
      (r) =>
        r.sessionKey !== ownKey &&
        r.lastCheckinAt >= since &&
        onDevice(r.deviceId)
    );

    const own = onDevice(ctx.client.deviceId)
      ? ownRow
        ? sessionFromRow(ctx, ownRow, ctx.profile, { remoteIp: req.userIp })
        : sessionInfo(
            ctx.uuid,
            ctx.userData,
            ctx.profile,
            ctx.client,
            req.userIp
          )
      : null;
    const sessions = await Promise.all([
      ...(own ? [own] : []),
      ...others.map((r) => sessionFromRow(ctx, r, ctx.profile, null)),
    ]);
    send(res, await withDevices(ctx, sessions, devices));
  })
);
router.post(
  ['/Sessions/Viewing', '/Sessions/Logout'],
  jfOptional(async (_req, res) => {
    res.status(204).end();
  })
);
router.all(
  '/Sessions/:sessionId/{*rest}',
  (req, _res, next) =>
    /^playing$/i.test(String(req.params.sessionId)) ? next('route') : next(),
  jf(async (_req, res) => {
    res.status(204).end();
  })
);

router.get(
  '/Devices',
  jf(async (req, res, ctx) => {
    res.json({
      Items: [
        {
          Name: ctx.client.device,
          Id: ctx.client.deviceId,
          LastUserName: profileName(ctx.userData, ctx.profile),
          AppName: ctx.client.name,
          AppVersion: ctx.client.version,
          LastUserId: ctx.userId,
          DateLastActivity: new Date().toISOString(),
          Capabilities: {
            PlayableMediaTypes: ['Video'],
            SupportedCommands: [],
            SupportsMediaControl: false,
            SupportsPersistentIdentifier: false,
          },
        },
      ],
      TotalRecordCount: 1,
      StartIndex: 0,
    });
  })
);
router.get(
  '/Devices/Info',
  jf(async (_req, res, ctx) => {
    res.json({
      Name: ctx.client.device,
      Id: ctx.client.deviceId,
      AppName: ctx.client.name,
      AppVersion: ctx.client.version,
    });
  })
);
router.get(
  '/Devices/Options',
  jf(async (_req, res) => {
    res.json({ CustomName: null });
  })
);
router.post(
  '/Devices/Options',
  jf(async (_req, res) => {
    res.status(204).end();
  })
);

export type { JellyfinRequestContext };
export { param };
export default router;
