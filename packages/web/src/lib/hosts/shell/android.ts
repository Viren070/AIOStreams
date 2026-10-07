import type { Host } from '..';
import { appBridge } from './bridge';
import { shellDownloads } from './downloads';
import { useShellPlayer } from './player';

export const androidHost: Host = {
  name: 'android-app',
  device: () => ({ name: appBridge()?.device }),
  usePlayer: useShellPlayer,
  playerFeatures: ['audio', 'chapters', 'stats'],
  downloads: shellDownloads,
};
