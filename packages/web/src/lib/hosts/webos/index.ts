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

function device(): { name: string } {
  try {
    const { modelName } = JSON.parse(system()?.deviceInfo ?? '{}') as {
      modelName?: string;
    };
    if (modelName) return { name: `LG ${modelName}` };
  } catch {}
  // eslint-disable-next-line lingui/no-unlocalized-strings -- how the server lists the device
  return { name: 'LG TV' };
}

const host: Host = {
  name: 'webos',
  tv: true,
  device,
  exit: () => system()?.platformBack?.(),
  keepAwake: (on) =>
    system()?.setWindowProperty?.('blockScreenSaver', String(on)),
  fetchFile: serviceFetch,
  resolveYouTube: youTubeResolver(serviceFetch),
};

export function webosHost(): Host | null {
  return system() ? host : null;
}
