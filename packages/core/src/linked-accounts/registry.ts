import { APIError, ErrorCode } from '../utils/constants.js';
import { aiomanagerPlatform } from './platforms/aiomanager.js';
import { stremioPlatform } from './platforms/stremio.js';
import type {
  LinkedAccountPlatform,
  LinkedAccountPlatformId,
  PlatformDescriptor,
} from './types.js';

const PLATFORMS: Record<LinkedAccountPlatformId, LinkedAccountPlatform> = {
  stremio: stremioPlatform,
  aiomanager: aiomanagerPlatform,
};

export function getPlatform(id: string): LinkedAccountPlatform {
  const platform = PLATFORMS[id as LinkedAccountPlatformId];
  if (!platform) {
    throw new APIError(ErrorCode.BAD_REQUEST, 400, `Unknown platform "${id}".`);
  }
  return platform;
}

export function listPlatforms(): PlatformDescriptor[] {
  return Object.values(PLATFORMS).map(
    ({
      id,
      name,
      kind,
      logo,
      description,
      commonFields,
      authMethods,
      probeOn,
    }) => ({
      id,
      name,
      kind,
      logo,
      description,
      commonFields,
      authMethods,
      probeOn,
    })
  );
}
