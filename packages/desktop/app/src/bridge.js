(() => {
  if (window.top !== window || window.aiostreamsDesktop) return;
  const listeners = new Set();
  let fullscreen = false;
  let idle = true;
  const send = (message) => window.ipc.postMessage(JSON.stringify(message));

  Object.defineProperty(window, '__aiostreamsDesktopReceive', {
    value(message) {
      if (message.type === 'fullscreen') fullscreen = message.value;
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
    send,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        send({ type: 'fullscreen' });
      } else if (e.key === 'Escape' && fullscreen) {
        send({ type: 'fullscreen', value: false });
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
