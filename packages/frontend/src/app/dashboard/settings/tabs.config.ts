import type { IconType } from 'react-icons';
import {
  BiCog,
  BiData,
  BiNetworkChart,
  BiListUl,
  BiServer,
  BiKey,
  BiBox,
  BiTachometer,
  BiImage,
  BiCloudDownload,
  BiTask,
  BiPalette,
  BiInfoCircle,
  BiFile,
} from 'react-icons/bi';

/**
 * Curated tab manifest. The schema-walker still generates the *fields* inside
 * each tab automatically — this only controls the tab list / labels / order /
 * grouping. Sections not listed here fall back to a title-cased label at the
 * end. Tiny sections can be folded into a parent tab via `foldInto`.
 */
export interface TabDef {
  /** Config section key (first path segment), or a synthetic id when folding. */
  section: string;
  label: string;
  icon: IconType;
  group: string;
  order: number;
}

export const TAB_MANIFEST: Record<string, Omit<TabDef, 'section'>> = {
  api: { label: 'General', icon: BiCog, group: 'Core', order: 1 },
  branding: { label: 'Branding', icon: BiPalette, group: 'Core', order: 2 },
  templates: { label: 'Templates', icon: BiFile, group: 'Core', order: 3 },
  metadata: { label: 'Metadata', icon: BiInfoCircle, group: 'Core', order: 4 },
  logging: { label: 'Logging', icon: BiListUl, group: 'Core', order: 5 },
  http: { label: 'HTTP', icon: BiNetworkChart, group: 'Network', order: 6 },
  proxy: { label: 'Proxy', icon: BiNetworkChart, group: 'Network', order: 7 },
  nzbProxy: {
    label: 'NZB Proxy',
    icon: BiCloudDownload,
    group: 'Network',
    order: 8,
  },
  rateLimits: {
    label: 'Rate Limits',
    icon: BiTachometer,
    group: 'Network',
    order: 9,
  },
  services: { label: 'Services', icon: BiKey, group: 'Content', order: 10 },
  presets: { label: 'Presets', icon: BiBox, group: 'Content', order: 11 },
  builtins: { label: 'Built-ins', icon: BiBox, group: 'Content', order: 12 },
  poster: { label: 'Posters', icon: BiImage, group: 'Content', order: 13 },
  resources: {
    label: 'Resources',
    icon: BiServer,
    group: 'Content',
    order: 14,
  },
  userLimits: { label: 'User Limits', icon: BiKey, group: 'Limits', order: 15 },
  recursion: {
    label: 'Recursion',
    icon: BiTachometer,
    group: 'Limits',
    order: 16,
  },
  tasks: { label: 'Tasks', icon: BiTask, group: 'Limits', order: 17 },
};

const FALLBACK_ICON = BiData;

/** Acronyms / hand-cased tokens to preserve when humanising a section key. */
const ACRONYMS: Record<string, string> = {
  api: 'API',
  url: 'URL',
  uri: 'URI',
  id: 'ID',
  ip: 'IP',
  ui: 'UI',
  ux: 'UX',
  sel: 'SEL',
  ssl: 'SSL',
  tls: 'TLS',
  tcp: 'TCP',
  udp: 'UDP',
  http: 'HTTP',
  https: 'HTTPS',
  nzb: 'NZB',
  rd: 'RD',
  ad: 'AD',
  pm: 'PM',
  dl: 'DL',
  tb: 'TB',
  bitmagnet: 'Bitmagnet',
  jackett: 'Jackett',
  zilean: 'Zilean',
  prowlarr: 'Prowlarr',
  torrentio: 'Torrentio',
  mediafusion: 'MediaFusion',
  comet: 'Comet',
  seadex: 'SeaDex',
  stremthru: 'StremThru',
  easynews: 'Easynews',
  debridio: 'Debridio',
  torbox: 'TorBox',
  putio: 'Put.io',
  offcloud: 'Offcloud',
  tmdb: 'TMDB',
  rpdb: 'RPDB',
  oauth: 'OAuth',
  gdrive: 'GDrive',
  sqlite: 'SQLite',
  postgres: 'Postgres',
  redis: 'Redis',
};

/**
 * Humanise a camelCase / kebab section or subsection key into a UI label.
 * Splits on case boundaries, hyphens and underscores; preserves acronyms;
 * title-cases plain words. Used as a fallback when `TAB_MANIFEST` has no
 * curated entry and for subsection headings inside `SettingsCard`.
 */
export function humanise(s: string): string {
  if (!s) return '';
  // Split camelCase: insert space before each uppercase that follows a lower
  // or another upper-lower transition (e.g. `nzbProxy` -> `nzb Proxy`,
  // `URLBuilder` -> `URL Builder`).
  const tokens = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(Boolean);
  return tokens
    .map((t) => {
      const lower = t.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function tabFor(section: string): Omit<TabDef, 'section'> {
  return (
    TAB_MANIFEST[section] ?? {
      label: humanise(section),
      icon: FALLBACK_ICON,
      group: 'Other',
      order: 999,
    }
  );
}
