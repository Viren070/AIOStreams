import type { Host } from '.';

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

// PalmSystem is its older name, kept for compatibility without a promise.
const system = () => window.webOSSystem ?? window.PalmSystem;

function device(): { name: string } {
  try {
    const { modelName } = JSON.parse(system()?.deviceInfo ?? '{}') as {
      modelName?: string;
    };
    if (modelName) return { name: `LG ${modelName}` };
  } catch {}
  return { name: 'LG TV' };
}

const host: Host = {
  name: 'webos',
  device,
  exit: () => system()?.platformBack?.(),
  keepAwake: (on) =>
    system()?.setWindowProperty?.('blockScreenSaver', String(on)),
};

/** LG's TVs, running the packaged app. */
export function webosHost(): Host | null {
  return system() ? host : null;
}
