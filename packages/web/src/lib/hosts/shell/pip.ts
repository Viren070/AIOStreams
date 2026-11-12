import { appBridge, bridgeStore } from './bridge';

const pip = bridgeStore('pip');

/**
 * The app shrunk to its video: the desktop app's window, or Android's
 * picture-in-picture. Kept here rather than in the player, whose page the
 * next title replaces while it lasts.
 */
export const useAppPip = (): boolean => !!pip.use()?.value;

/** The desktop app's window takes its size back; Android leaves on its own. */
export function leaveAppPip(): void {
  const shell = appBridge();
  if (shell && shell.platform !== 'android' && pip.get()?.value)
    shell.send({ type: 'pip', value: false });
}
