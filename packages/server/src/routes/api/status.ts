import { Router, Request, Response, NextFunction } from 'express';
import {
  Env,
  config as appConfig,
  getEnvironmentServiceDetails,
  PresetManager,
  SelAccess,
  UserRepository,
} from '@aiostreams/core';
import { StatusResponse } from '@aiostreams/core';
import { encryptString } from '@aiostreams/core';
import { RegexAccess, FeatureControl } from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';
import { getSeanimeExtensionVersion } from '../../utils/seanime.js';

const router: Router = Router();

const statusInfo = async (): Promise<StatusResponse> => {
  const shouldExposeUsers = appConfig.api.exposeUserCount;
  const userCount = shouldExposeUsers
    ? await UserRepository.getUserCount()
    : null;

  let forcedPublicProxyUrl: string | null = appConfig.proxy.force.publicUrl;

  const allowedRegexes = await RegexAccess.allowedRegexPatterns();

  return {
    version: appConfig.bootstrap.version,
    tag: appConfig.bootstrap.tag,
    channel: appConfig.bootstrap.channel as 'stable' | 'nightly' | 'dev',
    commit: appConfig.bootstrap.gitCommit,
    buildTime: appConfig.bootstrap.buildTime,
    commitTime: appConfig.bootstrap.buildCommitTime,
    users: shouldExposeUsers ? userCount : null,
    settings: {
      baseUrl: appConfig.bootstrap.baseUrl,
      addonName: appConfig.branding.addonName,
      customHtml: appConfig.branding.customHtml || undefined,
      featuredTemplateIds:
        appConfig.templates.featuredIds.length > 0
          ? appConfig.templates.featuredIds.slice(0, 2)
          : undefined,
      alternateDesign: appConfig.branding.alternateDesign,
      protected: appConfig.api.authRequired,
      tmdbApiAvailable: !!appConfig.metadata.tmdb.accessToken,
      regexAccess: {
        level: appConfig.userLimits.regex.access,
        ...allowedRegexes,
      },
      selSyncAccess: {
        level: appConfig.userLimits.sel.access,
        trustedUrls: SelAccess.getAllowedUrls(),
      },
      loggingSensitiveInfo: appConfig.logging.logSensitiveInfo,
      searchApiDisabled: !appConfig.api.enableSearchApi,
      nabApiDisabled: !appConfig.api.enableNabApi,
      seanimeExtensionVersion: getSeanimeExtensionVersion(),
      analyticsEnabled: appConfig.analytics.enabled !== false,
      userAnalyticsEnabled:
        appConfig.analytics.enabled !== false &&
        appConfig.analytics.userAnalyticsEnabled === true,
      forced: {
        proxy: {
          enabled: appConfig.proxy.force.enabled ?? null,
          id: appConfig.proxy.force.id ?? null,
          url: !!appConfig.proxy.force.url
            ? encryptString(appConfig.proxy.force.url).data
            : null,
          publicUrl: !!forcedPublicProxyUrl
            ? encryptString(forcedPublicProxyUrl).data
            : null,
          publicIp: appConfig.proxy.force.publicIp ?? null,
          credentials: !!appConfig.proxy.force.credentials
            ? encryptString(appConfig.proxy.force.credentials).data
            : null,
          proxiedServices: appConfig.proxy.force.proxiedServices ?? null,
          disableProxiedAddons: appConfig.proxy.force.disableProxiedAddons,
        },
      },
      defaults: {
        proxy: {
          enabled: appConfig.proxy.default.enabled ?? null,
          id: appConfig.proxy.default.id ?? null,
          url: !!appConfig.proxy.default.url
            ? encryptString(appConfig.proxy.default.url).data
            : null,
          publicUrl: appConfig.proxy.default.publicUrl
            ? encryptString(appConfig.proxy.default.publicUrl).data
            : null,
          publicIp: appConfig.proxy.default.publicIp ?? null,
          credentials: !!appConfig.proxy.default.credentials
            ? encryptString(appConfig.proxy.default.credentials).data
            : null,
          proxiedServices: appConfig.proxy.default.proxiedServices ?? null,
        },
        timeout: appConfig.presets.defaultTimeout ?? null,
      },
      presets: PresetManager.getPresetList().map((preset) => ({
        ...preset,
        DISABLED: FeatureControl.removedAddons.has(preset.ID)
          ? {
              reason:
                FeatureControl.removedAddons.get(preset.ID) ||
                'Removed by owner of the instance',
              removed: true,
              disabled: true,
            }
          : FeatureControl.disabledAddons.has(preset.ID)
            ? {
                reason:
                  FeatureControl.disabledAddons.get(preset.ID) ||
                  'Disabled by owner of the instance',
                disabled: true,
              }
            : preset.DISABLED,
      })),
      services: getEnvironmentServiceDetails(),
      limits: {
        maxMergedCatalogSources: appConfig.userLimits.maxMergedCatalogSources,
        maxStreamExpressions: appConfig.userLimits.sel.maxExpressions,
        maxStreamExpressionsTotalCharacters:
          appConfig.userLimits.sel.maxExpressionCharacters,
        maxAddons: appConfig.userLimits.maxAddons,
        maxNzbFailoverCount: appConfig.userLimits.maxNzbFailoverCount,
        maxBackgroundPings: appConfig.userLimits.maxBackgroundPings,
      },
    },
  };
};

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const info = await statusInfo();
    res.status(200).json(
      createResponse({
        success: true,
        data: info,
      })
    );
  } catch (error) {
    next(error);
  }
});

export default router;
