import { constants, Env } from '../index.js';
import { ParsedStream, UserData } from '../db/index.js';

/**
 * Generates the `bingeGroup` string for a stream based on the user's autoplay
 * settings. Returns `undefined` when autoplay is disabled.
 */
export function generateBingeGroup(
  stream: ParsedStream,
  index: number,
  userData: UserData
): string | undefined {
  const autoPlaySettings = {
    enabled: userData.autoPlay?.enabled ?? true,
    method: userData.autoPlay?.method ?? 'matchingFile',
    attributes:
      userData.autoPlay?.attributes ?? constants.DEFAULT_AUTO_PLAY_ATTRIBUTES,
  };

  if (!autoPlaySettings.enabled) {
    return undefined;
  }

  const identifyingAttributes = autoPlaySettings.attributes
    .map((attribute) => {
      switch (attribute) {
        case 'service':
          return stream.service?.id ?? 'no service';
        case 'type':
          return stream.type;
        case 'proxied':
          return stream.proxied;
        case 'addon':
          return stream.addon.name;
        case 'infoHash':
          return stream.torrent?.infoHash;
        case 'size':
          return (() => {
            const size = stream.size;
            if (!size || typeof size !== 'number' || isNaN(size)) return;

            const KB = 1024;
            const MB = 1024 * KB;
            const GB = 1024 * MB;

            if (size < 5 * GB) {
              if (size < 100 * MB) return '0-100MB';
              if (size > 100 * MB && size < 300 * MB) return '100-300MB';
              if (size > 300 * MB && size < 500 * MB) return '300-500MB';
              if (size > 500 * MB && size < 1 * GB) return '500MB-1GB';
              if (size > 1 * GB && size < 2 * GB) return '1-2GB';
              if (size > 2 * GB && size < 3 * GB) return '2-3GB';
              if (size > 3 * GB && size < 4 * GB) return '3-4GB';
              if (size > 4 * GB && size < 5 * GB) return '4-5GB';
              return '5GB+';
            }

            const sizeInGB = size / GB;
            const lower = Math.floor(
              Math.pow(1.5, Math.floor(Math.log(sizeInGB) / Math.log(1.5)))
            );
            const upper = Math.floor(
              Math.pow(1.5, Math.floor(Math.log(sizeInGB) / Math.log(1.5)) + 1)
            );

            if (lower === upper) {
              return `${upper}GB+`;
            }

            return `${lower}-${upper}GB`;
          })();
        default:
          return stream.parsedFile?.[attribute];
      }
    })
    .flat()
    .filter((attribute) => {
      if (attribute === undefined || attribute === null) return false;
      if (Array.isArray(attribute)) return attribute.length > 0;
      return true;
    });

  let bingeGroup = Env.ADDON_ID;

  switch (autoPlaySettings.method) {
    case 'matchingFile':
      bingeGroup += `|${identifyingAttributes.join('|')}`;
      break;
    case 'matchingIndex':
      bingeGroup += `|${index.toString()}`;
      break;
  }

  return bingeGroup;
}
