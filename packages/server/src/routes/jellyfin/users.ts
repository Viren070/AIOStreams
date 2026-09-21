import { createHash } from 'crypto';
import { Router, type Request } from 'express';
import {
  Cache,
  createLogger,
  descriptorForWatchRow,
  encryptString,
  getSimpleTextHash,
  isConfigUuid,
  mintToken,
  personaUserId,
  quickConnectConsume,
  resolveConfigAlias,
  serverId as instanceServerId,
  sessionKeyFor,
  stripInternal,
  TICKS_PER_MS,
  WatchSessionRepository,
  type ClientInfo,
  type JellyfinItem,
  type JellyfinPersona,
  type UserData,
  type WatchSessionRow,
} from '@aiostreams/core';
import {
  jf,
  jfOptional,
  param,
  personaById,
  personaByName,
  personasOf,
  qs,
  resolveConfig,
  type JellyfinRequestContext,
} from './context.js';
import { itemFromDescriptor } from './items.js';
import { serverName } from './system.js';

const logger = createLogger('jellyfin');
const router: Router = Router({ mergeParams: true });

export function userConfiguration() {
  return {
    PlayDefaultAudioTrack: true,
    SubtitleLanguagePreference: '',
    DisplayMissingEpisodes: false,
    GroupedFolders: [],
    SubtitleMode: 'Default',
    DisplayCollectionsView: false,
    EnableLocalPassword: false,
    OrderedViews: [],
    LatestItemsExcludes: [],
    MyMediaExcludes: [],
    HidePlayedInLatest: true,
    RememberAudioSelections: true,
    RememberSubtitleSelections: true,
    EnableNextEpisodeAutoPlay: true,
    CastReceiverId: '',
  };
}

export function userPolicy(opts: { admin?: boolean; hidden?: boolean } = {}) {
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
    SyncPlayAccess: 'None',
  };
}

type Faced = Pick<UserData, 'addonName' | 'jellyfin'>;

/** The primary user's name, which stood in for a configuration before it had one. */
function accountName(userData: Faced): string {
  return userData.jellyfin?.primary?.name || userData.addonName || serverName();
}

/** Changes whenever the picture would, so a client drops its cached copy. */
function avatarTag(avatar: string | undefined): string | undefined {
  return avatar ? getSimpleTextHash(avatar).slice(0, 16) : undefined;
}

/**
 * `pickable` rows come from the pre-authenticated address, which already
 * proved the credential, so a client signs in with one tap and no password.
 * `forKey` rows make the primary user the administrator an API key acts as.
 */
export function userDto(
  uuid: string,
  userData: Faced,
  persona: JellyfinPersona | null,
  opts: { pickable?: boolean; forKey?: boolean } = {}
) {
  const pickable = opts.pickable ?? false;
  const now = new Date().toISOString();
  const tag = avatarTag(
    persona ? persona.avatar : userData.jellyfin?.primary?.avatar
  );
  return {
    Name: persona?.name ?? accountName(userData),
    ServerId: instanceServerId(),
    ServerName: serverName(),
    Id: personaUserId(uuid, persona?.id ?? ''),
    ...(tag ? { PrimaryImageTag: tag } : {}),
    HasPassword: !pickable,
    HasConfiguredPassword: !pickable,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: true,
    LastLoginDate: now,
    LastActivityDate: now,
    Configuration: userConfiguration(),
    Policy: opts.forKey
      ? userPolicy({ admin: !persona, hidden: persona?.hidden })
      : userPolicy(),
  };
}

function sessionId(client: ClientInfo, userId: string): string {
  return createHash('md5')
    .update(`${client.name}${client.deviceId}${userId}`)
    .digest('hex');
}

export function sessionInfo(
  uuid: string,
  userData: Faced,
  persona: JellyfinPersona | null,
  client: ClientInfo,
  remoteIp: string | undefined
) {
  const now = new Date().toISOString();
  const userId = personaUserId(uuid, persona?.id ?? '');
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
      SupportedCommands: [],
      SupportsMediaControl: false,
      SupportsPersistentIdentifier: false,
    },
    RemoteEndPoint: remoteIp ?? '',
    PlayableMediaTypes: ['Video'],
    Id: sessionId(client, userId),
    UserId: userId,
    UserName: persona?.name ?? accountName(userData),
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
    SupportedCommands: [],
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

async function authenticationResult(
  req: Request,
  uuid: string,
  encryptedPassword: string,
  userData: UserData,
  persona: JellyfinPersona | null
) {
  const client = clientOf(req);
  return {
    User: userDto(uuid, userData, persona),
    SessionInfo: sessionInfo(uuid, userData, persona, client, req.userIp),
    AccessToken: mintToken({
      u: uuid,
      p: encryptedPassword,
      d: client.deviceId,
      k: persona?.id,
    }),
    ServerId: instanceServerId(),
  };
}

/** Every user of one configuration, the account first. */
function allUsers(
  uuid: string,
  userData: UserData,
  opts: { pickable?: boolean; forKey?: boolean } = {}
) {
  return [
    userDto(uuid, userData, null, opts),
    ...personasOf(userData)
      .filter((p) => opts.forKey || !p.hidden)
      .map((p) => userDto(uuid, userData, p, opts)),
  ];
}

/**
 * The persona a sign-in named. The account answers to its own name and to an
 * empty one; anything else must be a persona, since a picker posts back the
 * exact name it was shown.
 */
function resolveSignIn(
  userData: UserData,
  name: string
): { persona: JellyfinPersona | null } | null {
  if (!name) return { persona: null };
  const persona = personaByName(userData, name);
  if (persona) return { persona };
  if (name.trim().toLowerCase() === accountName(userData).toLowerCase()) {
    return { persona: null };
  }
  return null;
}

router.get(
  '/Users/Public',
  jfOptional(async (req, res, ctx) => {
    if (ctx?.preAuthenticated) {
      res.json(allUsers(ctx.uuid, ctx.userData, { pickable: true }));
      return;
    }
    // No configuration to list for, and an empty list is what makes a client
    // show the manual form that takes a uuid or alias.
    res.json([]);
  })
);

router.post(
  '/Users/AuthenticateByName',
  jfOptional(async (req, res, ctx) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = String(body.Username ?? body.username ?? '').trim();
    const pw = String(
      body.Pw ?? body.pw ?? body.Password ?? body.password ?? ''
    );

    let uuid: string | undefined;
    let encryptedPassword: string | undefined;
    let personaName: string;
    if (ctx?.preAuthenticated) {
      uuid = ctx.uuid;
      encryptedPassword = ctx.encryptedPassword;
      personaName = username;
    } else {
      // `<uuid or alias>/<persona>`; neither side can contain a slash.
      const slash = username.lastIndexOf('/');
      const account = slash >= 0 ? username.slice(0, slash) : username;
      personaName = slash >= 0 ? username.slice(slash + 1) : '';
      if (!account) {
        res.status(401).json({
          Message: 'Username (configuration UUID or alias) is required',
        });
        return;
      }
      if (isConfigUuid(account)) {
        const enc = encryptString(pw);
        if (!enc.success || !enc.data) {
          res.status(500).json({ Message: 'Encryption failure' });
          return;
        }
        uuid = account;
        encryptedPassword = enc.data;
      } else {
        // an alias already carries its password, the way alias URLs do
        const alias = await resolveConfigAlias(account);
        if (!alias) {
          res.status(401).json({ Message: 'Invalid username or password' });
          return;
        }
        uuid = alias.uuid;
        encryptedPassword = alias.encryptedPassword;
      }
    }

    const userData = await resolveConfig(uuid, encryptedPassword);
    if (!userData) {
      res.status(401).json({ Message: 'Invalid username or password' });
      return;
    }
    const signIn = resolveSignIn(userData, personaName);
    if (!signIn) {
      res.status(401).json({ Message: 'Invalid username or password' });
      return;
    }
    const client = clientOf(req);
    logger.info(
      {
        uuid,
        persona: signIn.persona?.id,
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
        signIn.persona
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
    const persona = entry.persona ? personaById(userData, entry.persona) : null;
    if (entry.persona && !persona) {
      logger.warn(
        { uuid: entry.uuid, persona: entry.persona },
        'quick connect persona no longer exists, signing in as the account'
      );
    }
    logger.info(
      {
        uuid: entry.uuid,
        persona: persona?.id,
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
        persona
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
    res.json(userDto(ctx.uuid, ctx.userData, ctx.persona));
  })
);
router.get(
  '/Users',
  jf(async (_req, res, ctx) => {
    res.json(allUsers(ctx.uuid, ctx.userData, { forKey: !!ctx.apiKey }));
  })
);
/* Read only: a user token's persona is its own, never the id in the URL. */
router.get(
  '/Users/:userId',
  jf(async (req, res, ctx) => {
    const wanted = param(req, 'userId').toLowerCase();
    const persona =
      wanted === personaUserId(ctx.uuid, '')
        ? null
        : (personasOf(ctx.userData).find(
            (p) => personaUserId(ctx.uuid, p.id) === wanted
          ) ?? ctx.persona);
    res.json(
      userDto(ctx.uuid, ctx.userData, persona, { forKey: !!ctx.apiKey })
    );
  })
);
router.get(
  '/Users/:userId/Configuration',
  jf(async (_req, res) => {
    res.json(userConfiguration());
  })
);
router.post(
  ['/Users/Configuration', '/Users/:userId/Configuration'],
  jf(async (_req, res) => {
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
const NOW_PLAYING_TTL = 600;
const NOW_PLAYING_MISS_TTL = 30;
const NOW_PLAYING_OMIT = [
  'MediaSources',
  'MediaStreams',
  'People',
  'Tags',
  'RemoteTrailers',
  'UserData',
];

const nowPlayingCache = Cache.getInstance<
  string,
  JellyfinItem | { missing: true }
>('jellyfin-now-playing', 5_000, 'memory');

async function nowPlayingItem(
  ctx: JellyfinRequestContext,
  row: WatchSessionRow
): Promise<JellyfinItem | null> {
  const key = `${ctx.userId}|${ctx.scope()}|${row.itemKey}|${row.durationMs}`;
  const hit = await nowPlayingCache.get(key);
  if (hit) return 'missing' in hit ? null : hit;

  const built = await itemFromDescriptor(ctx, descriptorForWatchRow(row)).catch(
    () => null
  );
  if (!built) {
    await nowPlayingCache.set(key, { missing: true }, NOW_PLAYING_MISS_TTL);
    return null;
  }
  const item = stripInternal(built) as JellyfinItem & Record<string, unknown>;
  for (const field of NOW_PLAYING_OMIT) delete item[field];
  if (row.durationMs > 0)
    item.RunTimeTicks = Math.round(row.durationMs) * TICKS_PER_MS;
  await nowPlayingCache.set(key, item, NOW_PLAYING_TTL);
  return item;
}

/** The caller's own session is the one this request is from, so it is active now. */
async function sessionFromRow(
  ctx: JellyfinRequestContext,
  row: WatchSessionRow,
  user: JellyfinPersona | null,
  own: { remoteIp: string | undefined } | null
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
  const item = playing ? await nowPlayingItem(ctx, row) : null;
  return {
    ...session,
    LastActivityDate: own ? session.LastActivityDate : checkIn,
    LastPlaybackCheckIn: checkIn,
    ...(playing
      ? {
          PlayState: {
            ...session.PlayState,
            PositionTicks: Math.round(row.positionMs) * TICKS_PER_MS,
            IsPaused: row.paused,
          },
        }
      : {}),
    ...(item ? { NowPlayingItem: item } : {}),
  };
}

/*
 * A non-administrator sees only their own sessions, so a user token gets the
 * clients of its history. An API key is the administrator and sees them all.
 */
router.get(
  '/Sessions',
  jf(async (req, res, ctx) => {
    // lists only sessions that take remote control, and none here do.
    if (qs(req, 'ControllableByUserId')) {
      res.json([]);
      return;
    }
    const within = Number(qs(req, 'ActiveWithinSeconds'));
    const since = within > 0 ? Date.now() - within * 1000 : 0;
    const deviceId = qs(req, 'DeviceId')?.toLowerCase();
    const onDevice = (id: string | null) =>
      !deviceId || id?.toLowerCase() === deviceId;

    if (ctx.apiKey) {
      const rows = await WatchSessionRepository.listForUuid(
        ctx.uuid,
        SESSIONS_LIMIT
      );
      const sessions = [];
      for (const row of rows) {
        if (row.lastCheckinAt < since || !onDevice(row.deviceId)) continue;
        const userKey = row.userPersona ?? row.persona;
        const user = userKey ? personaById(ctx.userData, userKey) : null;
        if (userKey && !user) continue;
        sessions.push(sessionFromRow(ctx, row, user, null));
      }
      res.json(await Promise.all(sessions));
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
        ? sessionFromRow(ctx, ownRow, ctx.persona, { remoteIp: req.userIp })
        : sessionInfo(
            ctx.uuid,
            ctx.userData,
            ctx.persona,
            ctx.client,
            req.userIp
          )
      : null;
    const sessions = await Promise.all([
      ...(own ? [own] : []),
      ...others.map((r) => sessionFromRow(ctx, r, ctx.persona, null)),
    ]);
    res.json(sessions);
  })
);
router.post(
  [
    '/Sessions/Capabilities',
    '/Sessions/Capabilities/Full',
    '/Sessions/Viewing',
    '/Sessions/Logout',
  ],
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
          LastUserName: ctx.persona?.name ?? accountName(ctx.userData),
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
