import { Router, Request, Response, NextFunction } from 'express';
import {
  Env,
  getEnvironmentServiceDetails,
  PresetManager,
  UserRepository,
} from '@aiostreams/core';
import { StatusResponse } from '@aiostreams/core';
import { encryptString } from '@aiostreams/core';
import { FeatureControl } from '@aiostreams/core';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const userCount = await UserRepository.getUserCount();
  const info: StatusResponse = {
    version: Env.VERSION,
    tag: Env.TAG,
    commit: Env.GIT_COMMIT,
    buildTime: Env.BUILD_TIME,
    commitTime: Env.BUILD_COMMIT_TIME,
    users: Env.EXPOSE_USER_COUNT ? userCount : null,
    settings: {
      baseUrl: Env.BASE_URL,
      addonName: Env.ADDON_NAME,
      customHtml: Env.CUSTOM_HTML,
      protected: !!Env.ADDON_PASSWORD,
      tmdbApiAvailable: !!Env.TMDB_ACCESS_TOKEN,
      regexFilterAccess: Env.REGEX_FILTER_ACCESS,
      loggingSensitiveInfo: Env.LOG_SENSITIVE_INFO,
      forced: {
        proxy: {
          enabled: Env.FORCE_PROXY_ENABLED ?? null,
          id: Env.FORCE_PROXY_ID ?? null,
          url: !!Env.FORCE_PROXY_URL
            ? encryptString(Env.FORCE_PROXY_URL).data
            : null,
          publicIp: Env.FORCE_PROXY_PUBLIC_IP ?? null,
          credentials: !!Env.FORCE_PROXY_CREDENTIALS
            ? encryptString(Env.FORCE_PROXY_CREDENTIALS).data
            : null,
          proxiedServices: Env.FORCE_PROXY_PROXIED_SERVICES ?? null,
          disableProxiedAddons: Env.FORCE_PROXY_DISABLE_PROXIED_ADDONS,
        },
      },
      defaults: {
        proxy: {
          enabled: Env.DEFAULT_PROXY_ENABLED ?? null,
          id: Env.DEFAULT_PROXY_ID ?? null,
          url: !!Env.DEFAULT_PROXY_URL
            ? encryptString(Env.DEFAULT_PROXY_URL).data
            : null,
          publicIp: Env.DEFAULT_PROXY_PUBLIC_IP ?? null,
          credentials: !!Env.DEFAULT_PROXY_CREDENTIALS
            ? encryptString(Env.DEFAULT_PROXY_CREDENTIALS).data
            : null,
          proxiedServices: Env.DEFAULT_PROXY_PROXIED_SERVICES ?? null,
        },
        timeout: Env.DEFAULT_TIMEOUT ?? null,
      },
      presets: PresetManager.getPresetList().map((preset) => ({
        ...preset,
        DISABLED: FeatureControl.disabledAddons.has(preset.ID)
          ? {
              reason:
                FeatureControl.disabledAddons.get(preset.ID) ||
                'Disabled by owner of the instance',
              disabled: true,
            }
          : undefined,
      })),
      services: getEnvironmentServiceDetails(),
    },
  };
  res.status(200).json({
    success: true,
    data: info,
  });
});

export default router;
