export type PlaybackHost = 'shell' | 'desktop' | 'android' | 'browser';

/**
 * Native apps load the server's web client and inject a bridge to their own
 * player, which plays anything.
 */
export function playbackHost(): PlaybackHost {
  if (window.aiostreamsDesktop?.protocol === 1) return 'shell';
  if (window.jmpInfo && window.apiPromise) return 'desktop';
  if (window.NativeInterface && window.NativePlayer?.isEnabled()) {
    return 'android';
  }
  return 'browser';
}
