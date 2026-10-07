import { currentHost } from '../hosts';
import { settings } from '../settings';
import { storage } from '../storage';

type Platform = 'ios' | 'android' | 'macos';

/** Players the desktop app starts and drives itself, as it names them. */
export const LAUNCHED_PLAYERS = [{ id: 'mpv', name: 'mpv' }] as const;

/** Extras the Android players read: a title, and where to start in ms. */
const ANDROID_EXTRAS = 'S.title={title};i.position={positionMs}';

const androidIntent = (target: string) =>
  `intent://{url}#Intent;${target};type=video/*;scheme={scheme};${ANDROID_EXTRAS};end`;

/**
 * Players opened by a link, on the platforms whose apps take one. An id can
 * have one entry per platform, so a saved choice follows the app across them.
 */
export const LINK_PLAYERS: readonly {
  id: string;
  name: string;
  /** What the help calls it, when the name doesn't fit a sentence. */
  target?: string;
  template: string;
  platforms: readonly Platform[];
}[] = [
  {
    id: 'vlc',
    name: 'VLC',
    template: 'vlc://{url}',
    platforms: ['ios'],
  },
  {
    id: 'vlc',
    name: 'VLC',
    template: androidIntent('package=org.videolan.vlc'),
    platforms: ['android'],
  },
  {
    id: 'mx-player',
    name: 'MX Player',
    template: androidIntent('package=com.mxtech.videoplayer.ad'),
    platforms: ['android'],
  },
  {
    id: 'mpv-android',
    name: 'mpv',
    template: androidIntent('package=is.xyz.mpv'),
    platforms: ['android'],
  },
  {
    id: 'android-app',
    name: 'Other app',
    target: 'the video app Android picks',
    template: androidIntent('action=android.intent.action.VIEW'),
    platforms: ['android'],
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
    template:
      'outplayer://x-callback-url/play?url={encodedUrl}&position={position}&subtitle={subtitles}&x-cancel={returnUrl}&x-success={returnUrl}',
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

/** Earlier templates of presets, as the old link setting saved them. */
const OLD_TEMPLATES: Record<string, string> = {
  'outplayer://{url}': 'outplayer',
};

/** What the link and the switch that came before the choice amounted to. */
function migrate() {
  const template = storage.get<unknown>('aiostreams-web-external-player');
  if (typeof template !== 'string') return;
  const preset =
    OLD_TEMPLATES[template] ??
    LINK_PLAYERS.find((p) => p.template === template)?.id;
  if (!preset) settings.playerLink.write(template);
  if (storage.get<boolean>('aiostreams-web-external-always') === true)
    settings.player.write(preset ?? CUSTOM_LINK);
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

/** The link preset saved as `id`, in this platform's form when it has one. */
export function linkPreset(id: string) {
  const os = platform();
  return (
    LINK_PLAYERS.find((p) => p.id === id && os && p.platforms.includes(os)) ??
    LINK_PLAYERS.find((p) => p.id === id)
  );
}

/** Where Play sends a version on this device; an app's own player always wins. */
export function chosenPlayer(): PlayerChoice {
  const host = currentHost();
  if (host.play) return { kind: 'app' };
  const id = settings.player.read();
  const launched = LAUNCHED_PLAYERS.find((p) => p.id === id);
  if (launched && host.name === 'desktop')
    return { kind: 'launched', ...launched };
  const preset = linkPreset(id);
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
      (p) =>
        p === linkPreset(p.id) &&
        (p.id === current || (os && p.platforms.includes(os)))
    ).map((p) => ({ value: p.id, label: p.name })),
    { value: CUSTOM_LINK, label: 'Custom link' },
  ];
}

/**
 * Writes each parameter (or intent extra) holding `{placeholder}` once per
 * value, and drops it when there are none rather than sending it empty.
 */
function fillParam(
  template: string,
  placeholder: string,
  values: string[]
): string {
  const params = new RegExp(`([?&;])([^=&?;]+)=\\{${placeholder}\\}`, 'g');
  if (template.search(params) < 0) {
    return template.replace(
      `{${placeholder}}`,
      encodeURIComponent(values[0] ?? '')
    );
  }
  const filled = template.replace(params, (_, separator: string, name) => {
    const between = separator === ';' ? ';' : '&';
    return values
      .map(
        (v, i) => `${i ? between : separator}${name}=${encodeURIComponent(v)}`
      )
      .join('');
  });
  return values.length ? filled : filled.replace(/^([^?]*)&/, '$1?');
}

/**
 * Fills a player link: `{url}` or `{encodedUrl}`, and optionally `{scheme}`
 * (the address's), `{position}` (seconds to start at) or `{positionMs}`,
 * `{title}` (with the episode for an episode), `{returnUrl}` (where a player
 * that reports back sends the position it stopped at), `{filename}` and
 * `{subtitles}` (its parameter repeated once per external subtitle).
 */
export function playerLink(
  template: string,
  url: string,
  opts: {
    startMs?: number;
    title?: string;
    returnUrl?: string;
    filename?: string;
    subtitles?: string[];
  } = {}
): string {
  const startMs = Math.floor(opts.startMs ?? 0);
  let filled = template
    .replace('{scheme}', new URL(url, location.href).protocol.slice(0, -1))
    .replace('{positionMs}', String(startMs))
    .replace('{position}', String(Math.floor(startMs / 1000)));
  filled = fillParam(filled, 'title', opts.title ? [opts.title] : []);
  filled = fillParam(
    filled,
    'returnUrl',
    opts.returnUrl ? [opts.returnUrl] : []
  );
  filled = fillParam(filled, 'filename', opts.filename ? [opts.filename] : []);
  filled = fillParam(filled, 'subtitles', opts.subtitles ?? []);
  const link = filled.includes('{encodedUrl}')
    ? filled.replace('{encodedUrl}', encodeURIComponent(url))
    : filled.includes('{url}')
      ? filled.replace('{url}', url)
      : `${filled}${url}`;
  // An intent link names the scheme apart, so the address follows it without one.
  return link.replace(/^intent:\/\/https?:\/\//i, 'intent://');
}
