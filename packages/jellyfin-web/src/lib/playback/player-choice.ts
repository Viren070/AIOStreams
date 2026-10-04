import { currentHost } from '../hosts';
import { settings } from '../settings';
import { storage } from '../storage';

type Platform = 'ios' | 'android' | 'macos';

/** Players the desktop app starts and drives itself, as it names them. */
export const LAUNCHED_PLAYERS = [{ id: 'mpv', name: 'mpv' }] as const;

/** Players opened by a link, on the platforms whose apps take one. */
export const LINK_PLAYERS: readonly {
  id: string;
  name: string;
  template: string;
  platforms: readonly Platform[];
}[] = [
  {
    id: 'vlc',
    name: 'VLC',
    template: 'vlc://{url}',
    platforms: ['ios', 'android'],
  },
  {
    id: 'infuse',
    name: 'Infuse',
    template:
      'infuse://x-callback-url/play?url={encodedUrl}&filename={filename}&sub={subtitles}&position={position}&x-success={returnUrl}',
    platforms: ['ios', 'macos'],
  },
  {
    id: 'outplayer',
    name: 'Outplayer',
    template: 'outplayer://{url}',
    platforms: ['ios'],
  },
  {
    id: 'iina',
    name: 'IINA',
    template: 'iina://weblink?url={encodedUrl}',
    platforms: ['macos'],
  },
];

export const CUSTOM_LINK = 'custom';

export type PlayerChoice =
  | { kind: 'app' }
  | { kind: 'launched'; id: string; name: string }
  | { kind: 'link'; id: string; name: string; template: string };

/** What the link and the switch that came before the choice amounted to. */
function migrate() {
  const template = storage.get<unknown>('aiostreams-web-external-player');
  if (typeof template !== 'string') return;
  const preset = LINK_PLAYERS.find((p) => p.template === template);
  if (!preset) settings.playerLink.write(template);
  if (storage.get<boolean>('aiostreams-web-external-always') === true)
    settings.player.write(preset?.id ?? CUSTOM_LINK);
  storage.remove('aiostreams-web-external-player');
  storage.remove('aiostreams-web-external-always');
}
migrate();

function platform(): Platform | null {
  if (window.aiostreamsDesktop?.platform === 'macos') return 'macos';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPads ask for the desktop site, so they read as a Mac with a touch screen.
  if (/macintosh/i.test(ua))
    return navigator.maxTouchPoints > 1 ? 'ios' : 'macos';
  return null;
}

/** Where Play sends a version on this device; an app's own player always wins. */
export function chosenPlayer(): PlayerChoice {
  const host = currentHost();
  if (host.play) return { kind: 'app' };
  const id = settings.player.read();
  const launched = LAUNCHED_PLAYERS.find((p) => p.id === id);
  if (launched && host.name === 'desktop')
    return { kind: 'launched', ...launched };
  const preset = LINK_PLAYERS.find((p) => p.id === id);
  if (preset) return { kind: 'link', ...preset };
  const template = settings.playerLink.read().trim();
  if (id === CUSTOM_LINK && template)
    return { kind: 'link', id, name: 'your player', template };
  return { kind: 'app' };
}

/** `launched` are the players the desktop app found it can start. */
export function playerOptions(
  launched: readonly string[]
): { value: string; label: string }[] {
  const current = settings.player.read();
  const os = platform();
  return [
    {
      value: 'app',
      label:
        currentHost().name === 'desktop' ? 'Built-in mpv' : 'Built-in player',
    },
    ...LAUNCHED_PLAYERS.filter(
      (p) => p.id === current || launched.includes(p.id)
    ).map((p) => ({ value: p.id, label: `Your own ${p.name}` })),
    ...LINK_PLAYERS.filter(
      (p) => p.id === current || (os && p.platforms.includes(os))
    ).map((p) => ({ value: p.id, label: p.name })),
    { value: CUSTOM_LINK, label: 'Custom link' },
  ];
}

/**
 * Writes the parameter holding `{placeholder}` once per value, and drops it
 * when there are none rather than sending it empty.
 */
function fillParam(
  template: string,
  placeholder: string,
  values: string[]
): string {
  const match = new RegExp(`([?&])([^=&?]+)=\{${placeholder}\}`).exec(template);
  if (!match) {
    return template.replace(
      `{${placeholder}}`,
      encodeURIComponent(values[0] ?? '')
    );
  }
  const [param, separator, name] = match;
  const written = values
    .map((v, i) => `${i ? '&' : separator}${name}=${encodeURIComponent(v)}`)
    .join('');
  const filled = template.replace(param, written);
  return written ? filled : filled.replace(/^([^?]*)&/, '$1?');
}

/**
 * Fills a player link: `{url}` or `{encodedUrl}`, and optionally `{position}`
 * (seconds to start at), `{returnUrl}` (where a player that reports back sends
 * the position it stopped at), `{filename}` and `{subtitles}` (its parameter
 * repeated once per external subtitle).
 */
export function playerLink(
  template: string,
  url: string,
  opts: {
    startMs?: number;
    returnUrl?: string;
    filename?: string;
    subtitles?: string[];
  } = {}
): string {
  let filled = template.replace(
    '{position}',
    String(Math.floor((opts.startMs ?? 0) / 1000))
  );
  filled = fillParam(
    filled,
    'returnUrl',
    opts.returnUrl ? [opts.returnUrl] : []
  );
  filled = fillParam(filled, 'filename', opts.filename ? [opts.filename] : []);
  filled = fillParam(filled, 'subtitles', opts.subtitles ?? []);
  if (filled.includes('{encodedUrl}'))
    return filled.replace('{encodedUrl}', encodeURIComponent(url));
  if (filled.includes('{url}')) return filled.replace('{url}', url);
  return `${filled}${url}`;
}
