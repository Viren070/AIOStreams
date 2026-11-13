import { startInput } from '@/lib/input';
import { createLive, useLive } from '@/lib/live-value';
import { appLog } from '@/lib/hosts/shell/bridge';

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

const api = (): DocumentPictureInPicture | undefined =>
  (window as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture;

const shown = createLive<Window | null>(null);
const leaving = new Set<() => void>();

export const canUseDocumentPip = (): boolean => !!api();

/** The browser also has its own window for a video alone. */
export const canPickPipWindow = (): boolean =>
  canUseDocumentPip() && !!document.pictureInPictureEnabled;

/**
 * Kept here rather than in the player, whose page the next title replaces
 * while the window stays.
 */
export const useDocumentPip = (): Window | null => useLive(shown);

/** Runs as the window closes, while what it shows can still move back. */
export function onDocumentPipLeave(listener: () => void): () => void {
  leaving.add(listener);
  return () => leaving.delete(listener);
}

function copyPage(into: Document): void {
  for (const sheet of document.styleSheets) {
    try {
      const style = into.createElement('style');
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join(
        '\n'
      );
      into.head.append(style);
    } catch {
      if (!sheet.href) continue;
      const link = into.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      into.head.append(link);
    }
  }
  for (const { name, value } of document.documentElement.attributes)
    into.documentElement.setAttribute(name, value);
  into.body.className = document.body.className;
  into.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
}

/** Needs the user's click or key press; a window already open is kept. */
export async function openDocumentPip(size: {
  width: number;
  height: number;
}): Promise<void> {
  const pip = api();
  if (!pip || shown.get()) return;
  const win = await pip.requestWindow(size).catch((error: unknown) => {
    appLog('warn', `picture-in-picture: ${String(error)}`);
    return null;
  });
  if (!win) return;
  copyPage(win.document);
  win.document.title = document.title;
  const stopInput = startInput(win);
  win.addEventListener(
    'pagehide',
    () => {
      stopInput();
      leaving.forEach((listener) => listener());
      shown.set(null);
    },
    { once: true }
  );
  shown.set(win);
}

export function closeDocumentPip(): void {
  shown.get()?.close();
}
