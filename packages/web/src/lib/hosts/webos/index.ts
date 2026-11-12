import type { Host } from '..';
import { serviceFetch } from './service';
import { youTubeResolver } from '@/lib/hosts/youtube';

interface WebOSSystem {
  deviceInfo?: string;
  platformBack?(): void;
  setWindowProperty?(name: string, value: string): void;
}

declare global {
  interface Window {
    webOSSystem?: WebOSSystem;
    PalmSystem?: WebOSSystem;
  }
}

// PalmSystem is its older name.
const system = () => window.webOSSystem ?? window.PalmSystem;

function deviceInfo(): { modelName?: string; platformVersion?: string } {
  try {
    return JSON.parse(system()?.deviceInfo ?? '{}');
  } catch {
    return {};
  }
}

function device(): { name: string } {
  const { modelName } = deviceInfo();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- how the server lists the device
  return { name: modelName ? `LG ${modelName}` : 'LG TV' };
}

const host: Host = {
  name: 'webos',
  tv: true,
  device,
  system: () => {
    const { modelName, platformVersion } = deviceInfo();
    return {
      name: 'webOS',
      version: platformVersion ?? '',
      model: modelName ?? '',
    };
  },
  exit: () => system()?.platformBack?.(),
  keepAwake: (on) =>
    system()?.setWindowProperty?.('blockScreenSaver', String(on)),
  fetchFile: serviceFetch,
  resolveYouTube: youTubeResolver(serviceFetch),
};

export function webosHost(): Host | null {
  return system() ? host : null;
}
