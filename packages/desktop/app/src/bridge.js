(() => {
  if (window.top !== window || window.aiostreamsDesktop) return;
  const listeners = new Set();
  let idle = true;
  const send = (message) => window.ipc.postMessage(JSON.stringify(message));

  Object.defineProperty(window, '__aiostreamsDesktopReceive', {
    value(message) {
      if (message.type === 'mpv-prop' && message.name === 'idle-active')
        idle = message.data !== false;
      for (const listener of listeners) {
        try {
          listener(message);
        } catch (error) {
          console.error(error);
        }
      }
    },
  });

  window.aiostreamsDesktop = Object.freeze({
    protocol: __PROTOCOL__,
    version: __VERSION__,
    platform: __PLATFORM__,
    device: __DEVICE__,
    send,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  // Errors go to the app's log file, where a user can find them for a report.
  const MAX_REPORTS = 100;
  let reports = 0;
  let lastReport = '';
  const describe = (value) =>
    value instanceof Error
      ? value.stack || `${value.name}: ${value.message}`
      : typeof value === 'string'
        ? value
        : (() => {
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          })();
  const report = (message) => {
    if (!message || message === lastReport || reports >= MAX_REPORTS) return;
    lastReport = message;
    reports++;
    send({ type: 'web-error', message });
    if (reports === MAX_REPORTS)
      send({
        type: 'web-error',
        message: 'further errors from this page are not logged',
      });
  };
  window.addEventListener('error', (e) =>
    report(
      e.error ? describe(e.error) : `${e.message} (${e.filename}:${e.lineno})`
    )
  );
  window.addEventListener('unhandledrejection', (e) =>
    report(`unhandled rejection: ${describe(e.reason)}`)
  );
  const consoleError = console.error;
  console.error = (...args) => {
    report(args.map(describe).join(' '));
    consoleError.apply(console, args);
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        send({ type: 'fullscreen' });
      }
    },
    true
  );

  const KEY_NAMES = {
    ' ': 'SPACE',
    '#': 'SHARP',
    Enter: 'ENTER',
    Escape: 'ESC',
    Tab: 'TAB',
    Backspace: 'BS',
    Delete: 'DEL',
    Insert: 'INS',
    Home: 'HOME',
    End: 'END',
    PageUp: 'PGUP',
    PageDown: 'PGDWN',
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
  };
  const mpvKey = (e) => {
    const key =
      KEY_NAMES[e.key] ??
      (e.key.length === 1 || /^F\d{1,2}$/.test(e.key) ? e.key : null);
    if (!key) return null;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta'];
    // mpv names a shifted character by the character itself.
    if (e.shiftKey && key.length > 1) mods.push('Shift');
    return [...mods.filter(Boolean), key].join('+');
  };

  // Keys the page leaves alone reach mpv, so input.conf bindings still work.
  window.addEventListener('keydown', (e) => {
    const target = e.target;
    if (idle || target?.closest?.('input, textarea, select, [contenteditable]'))
      return;
    setTimeout(() => {
      const key = !e.defaultPrevented && mpvKey(e);
      if (key) send({ type: 'mpv-command', args: ['keypress', key] });
    });
  });
})();
