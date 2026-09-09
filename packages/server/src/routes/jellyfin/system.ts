import { Router, type Request } from 'express';
import {
  config as appConfig,
  JellyfinRepository,
  serverId as instanceServerId,
} from '@aiostreams/core';
import { jf, jfOptional, param, qs, requestOrigin } from './context.js';

const router: Router = Router({ mergeParams: true });

export const JELLYFIN_PRODUCT_NAME = 'Jellyfin Server';

export function serverName(): string {
  return appConfig.branding.addonName || 'AIOStreams';
}

export function publicInfo(req: Request) {
  return {
    LocalAddress: `${requestOrigin(req)}${req.baseUrl}`.replace(/\/$/, ''),
    ServerName: req.jf?.userData.addonName || serverName(),
    Version: appConfig.jellyfin.version,
    ProductName: JELLYFIN_PRODUCT_NAME,
    OperatingSystem: '',
    Id: instanceServerId(),
    StartupWizardCompleted: true,
  };
}

router.get('/System/Info/Public', (req, res) => {
  res.json(publicInfo(req));
});

router.get(
  '/System/Info',
  jf(async (req, res) => {
    res.json({
      ...publicInfo(req),
      SystemArchitecture: 'X64',
      OperatingSystemDisplayName: '',
      HasPendingRestart: false,
      IsShuttingDown: false,
      SupportsLibraryMonitor: false,
      WebSocketPortNumber: appConfig.bootstrap.port,
      CompletedInstallations: [],
      CanSelfRestart: true,
      CanLaunchWebBrowser: false,
      ProgramDataPath: '/config',
      WebPath: '/web',
      ItemsByNamePath: '/config/metadata',
      CachePath: '/cache',
      LogPath: '/config/log',
      InternalMetadataPath: '/config/metadata',
      TranscodingTempPath: '/cache/transcodes',
      CastReceiverApplications: [],
      HasUpdateAvailable: false,
      EncoderLocation: 'System',
      PackageName: 'aiostreams',
    });
  })
);

router.all('/System/Ping', (_req, res) => {
  res.json(JELLYFIN_PRODUCT_NAME);
});

router.get('/System/Endpoint', (_req, res) => {
  res.json({ IsLocal: false, IsInNetwork: false });
});

router.get(
  '/System/Configuration',
  jf(async (_req, res) => {
    res.json({
      EnableMetrics: false,
      ServerName: serverName(),
      PreferredMetadataLanguage: 'en',
      MetadataCountryCode: 'US',
      EnableCaseSensitiveItemIds: true,
      EnableFolderView: false,
      EnableGroupingIntoCollections: false,
      DisplaySpecialsWithinSeasons: true,
      UICulture: 'en-US',
      SaveMetadataHidden: false,
      ContentTypes: [],
      RemoteClientBitrateLimit: 0,
      EnableSlowResponseWarning: false,
      LibraryScanFanoutConcurrency: 0,
      LibraryMetadataRefreshConcurrency: 0,
      PluginRepositories: [],
      CorsHosts: ['*'],
      IsStartupWizardCompleted: true,
      EnableLegacyAuthorization: true,
    });
  })
);

router.get('/Branding/Configuration', (_req, res) => {
  res.json({
    LoginDisclaimer: `Sign in with your ${serverName()} configuration UUID or alias and its password, or approve a Quick Connect code from the configuration page.`,
    CustomCss: '',
    SplashscreenEnabled: false,
  });
});
router.get(['/Branding/Css', '/Branding/Css.css'], (_req, res) => {
  res.type('text/css').send('');
});

router.get('/Localization/Cultures', (_req, res) => {
  res.json([
    {
      Name: 'English',
      DisplayName: 'English',
      TwoLetterISOLanguageName: 'en',
      ThreeLetterISOLanguageName: 'eng',
      ThreeLetterISOLanguageNames: ['eng'],
    },
  ]);
});
router.get('/Localization/Countries', (_req, res) => {
  res.json([
    {
      Name: 'US',
      DisplayName: 'United States',
      TwoLetterISORegionName: 'US',
      ThreeLetterISORegionName: 'USA',
    },
  ]);
});
router.get('/Localization/Options', (_req, res) => {
  res.json([{ Name: 'English (United States)', Value: 'en-US' }]);
});
router.get('/Localization/ParentalRatings', (_req, res) => {
  res.json([]);
});

/* Clients read these keys unguarded, so every one has to be present. */
const DEFAULT_DISPLAY_PREFS = (id: string, client: string) => ({
  Id: id,
  ViewType: null,
  SortBy: 'SortName',
  IndexBy: null,
  RememberIndexing: false,
  PrimaryImageHeight: 250,
  PrimaryImageWidth: 250,
  CustomPrefs: {
    chromecastVersion: 'stable',
    skipForwardLength: '30000',
    skipBackLength: '10000',
    enableNextVideoInfoOverlay: 'true',
    tvhome: null,
    dashboardTheme: null,
  },
  ScrollDirection: 'Horizontal',
  ShowBackdrop: true,
  RememberSorting: false,
  SortOrder: 'Ascending',
  ShowSidebar: false,
  Client: client,
});

router.get(
  '/DisplayPreferences/:id',
  jf(async (req, res, ctx) => {
    const client = qs(req, 'client') || 'emby';
    const id = param(req, 'id');
    const stored = await JellyfinRepository.getDisplayPrefs(
      ctx.watch,
      id,
      client
    );
    const defaults = DEFAULT_DISPLAY_PREFS(id, client);
    res.json({
      ...defaults,
      ...(stored ?? {}),
      CustomPrefs: {
        ...defaults.CustomPrefs,
        ...((stored?.CustomPrefs as object) ?? {}),
      },
    });
  })
);
router.post(
  '/DisplayPreferences/:id',
  jf(async (req, res, ctx) => {
    const client = qs(req, 'client') || 'emby';
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : {};
    await JellyfinRepository.setDisplayPrefs(
      ctx.watch,
      param(req, 'id'),
      client,
      body
    );
    res.status(204).end();
  })
);

router.get('/Startup/{*rest}', (_req, res) => {
  res.json({});
});
router.post('/Startup/{*rest}', (_req, res) => {
  res.status(204).end();
});

/* Some clients resolve the PWA manifest against the server. */
router.get(
  '/web/manifest.json',
  jfOptional(async (_req, res) => {
    res.json({
      name: serverName(),
      short_name: serverName(),
      start_url: '/',
      display: 'standalone',
      icons: [],
    });
  })
);

export default router;
