import { Router, type Request } from 'express';
import {
  createLogger,
  encryptString,
  getSimpleTextHash,
  isConfigUuid,
  mintToken,
  personaUserId,
  quickConnectConsume,
  resolveConfigAlias,
  serverId as instanceServerId,
  type ClientInfo,
  type JellyfinPersona,
  type UserData,
} from '@aiostreams/core';
import {
  jf,
  jfOptional,
  param,
  personaById,
  personaByName,
  personasOf,
  resolveConfig,
  type JellyfinRequestContext,
} from './context.js';
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

export function userPolicy() {
  return {
    IsAdministrator: false,
    IsHidden: false,
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
 */
export function userDto(
  uuid: string,
  userData: Faced,
  persona: JellyfinPersona | null,
  pickable = false
) {
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
    Policy: userPolicy(),
  };
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
    Id: `${userId}-${client.deviceId}`,
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
function allUsers(uuid: string, userData: UserData, pickable = false) {
  return [
    userDto(uuid, userData, null, pickable),
    ...personasOf(userData)
      .filter((p) => !p.hidden)
      .map((p) => userDto(uuid, userData, p, pickable)),
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
      res.json(allUsers(ctx.uuid, ctx.userData, true));
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
    res.json(userDto(ctx.uuid, ctx.userData, ctx.persona));
  })
);
router.get(
  '/Users',
  jf(async (_req, res, ctx) => {
    res.json(allUsers(ctx.uuid, ctx.userData));
  })
);
/* Read only: the signed-in persona is the token's, never the id in the URL. */
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
    res.json(userDto(ctx.uuid, ctx.userData, persona));
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

router.get(
  '/Sessions',
  jf(async (req, res, ctx) => {
    res.json([
      sessionInfo(ctx.uuid, ctx.userData, ctx.persona, ctx.client, req.userIp),
    ]);
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
