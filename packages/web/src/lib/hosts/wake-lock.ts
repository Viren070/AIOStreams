let held = false;
let lock: WakeLockSentinel | null = null;
let asking = false;
let listening = false;

function ask() {
  if (
    !held ||
    lock ||
    asking ||
    !('wakeLock' in navigator) ||
    document.visibilityState !== 'visible'
  )
    return;
  asking = true;
  navigator.wakeLock.request('screen').then(
    (granted) => {
      asking = false;
      if (!held) return void granted.release().catch(() => {});
      lock = granted;
      granted.addEventListener('release', () => {
        if (lock === granted) lock = null;
      });
    },
    () => {
      asking = false;
    }
  );
}

/** Keeps the screen on while held; the browser drops the lock while the page is hidden, so a visible page asks again. */
export function keepScreenOn(on: boolean): void {
  held = on;
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', ask);
  }
  if (on) return ask();
  void lock?.release().catch(() => {});
  lock = null;
}
