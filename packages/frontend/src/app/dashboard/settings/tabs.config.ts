import type { IconType } from 'react-icons';
import {
  BiBlock,
  BiBox,
  BiCog,
  BiData,
  BiGroup,
  BiInfoCircle,
  BiKey,
  BiListUl,
  BiNetworkChart,
  BiPalette,
  BiPlayCircle,
  BiPlug,
  BiShareAlt,
  BiSitemap,
  BiTachometer,
  BiTransferAlt,
  BiUserCheck,
} from 'react-icons/bi';

/**
 * Curated tab manifest. The schema-walker still generates the fields inside
 * each tab; this only controls the tab list, labels, order and grouping.
 * Sections not listed here fall back to a catch-all group.
 *
 * Two rules keep it navigable: every tab gets a distinct icon, since that is
 * all the collapsed rail shows; and a tab mirroring a dashboard page reuses
 * that page's icon and name. `order` steps by 10 to leave room between tabs.
 */
export interface TabDef {
  /** Tab id. Usually a config section key; synthetic when `sections` is set. */
  section: string;
  label: string;
  icon: IconType;
  group: string;
  order: number;
  /**
   * Dotted key prefixes this tab claims. A prefix may be a whole section
   * (`services`) or a subsection (`proxy.force`), so a section can be split
   * across tabs; the longest match wins. See {@link cardPath} for headings.
   */
  sections?: string[];
}

export const TAB_MANIFEST: Record<string, Omit<TabDef, 'section'>> = {
  // --- the instance itself --------------------------------------------------
  general: {
    label: 'General',
    icon: BiCog,
    group: 'General',
    order: 10,
    // Templates are part of instance setup, not a topic of their own.
    sections: ['api', 'templates'],
  },
  branding: { label: 'Branding', icon: BiPalette, group: 'General', order: 20 },
  logging: { label: 'Logging', icon: BiListUl, group: 'General', order: 30 },
  oidc: { label: 'SSO / OIDC', icon: BiKey, group: 'General', order: 35 },
  retention: {
    label: 'Data & Retention',
    icon: BiData,
    group: 'General',
    order: 40,
    // Both sides of how long things are kept.
    sections: ['tasks', 'analytics'],
  },

  // --- what AIOStreams itself does ------------------------------------------
  // Wrapping upstream addons, plus what that leans on: metadata drives built-in
  // search and filtering, blocklists drive what gets through.
  presets: { label: 'Presets', icon: BiBox, group: 'Core', order: 110 },
  community: {
    label: 'Community',
    icon: BiShareAlt,
    group: 'Core',
    order: 115,
  },
  builtins: { label: 'Built-ins', icon: BiPlug, group: 'Core', order: 120 },
  resources: {
    label: 'Addon Resources',
    icon: BiSitemap,
    group: 'Core',
    order: 130,
  },
  metadata: {
    label: 'Metadata',
    icon: BiInfoCircle,
    group: 'Core',
    order: 140,
    // Poster handling is metadata presentation, and is a single setting.
    sections: ['metadata', 'poster'],
  },
  releaseBlocklist: {
    label: 'Blocklists',
    icon: BiBlock,
    group: 'Core',
    order: 150,
  },

  // --- what lands in each user's configuration ------------------------------
  userDefaults: {
    label: 'User Defaults',
    icon: BiUserCheck,
    group: 'Users',
    order: 210,
    // The credentials and proxy an operator pre-fills or forces into every
    // user's config. The rest of `proxy` is instance behaviour.
    sections: ['services', 'proxy.default', 'proxy.force'],
  },
  userLimits: {
    label: 'User Limits',
    icon: BiGroup,
    group: 'Users',
    order: 220,
  },
  rateLimits: {
    label: 'Rate Limits',
    icon: BiTachometer,
    group: 'Users',
    order: 230,
    // Recursion detection is a request-rate guard, so it sits with the other
    // throttles.
    sections: ['rateLimits', 'recursion'],
  },

  // --- traffic in and out ---------------------------------------------------
  http: {
    label: 'Outbound Requests',
    icon: BiNetworkChart,
    group: 'Traffic',
    order: 310,
  },
  proxy: {
    label: 'Proxy',
    icon: BiTransferAlt,
    group: 'Traffic',
    order: 320,
    // What's left of `proxy` once the per-user defaults move out.
    sections: ['proxy.encryption', 'proxy.ip'],
  },
  streams: {
    label: 'Streams',
    icon: BiPlayCircle,
    group: 'Traffic',
    order: 330,
  },
};

/** Claimed key prefix → tab id. */
const PREFIX_TO_TAB = new Map<string, string>(
  Object.entries(TAB_MANIFEST).flatMap(([id, def]) =>
    (def.sections ?? [id]).map((prefix) => [prefix, id] as [string, string])
  )
);

/**
 * Which tab renders a setting. Longest claimed prefix wins, so
 * `proxy.force.url` can land elsewhere than `proxy.encryption.*`. Falls back to
 * the section, so a new one gets a tab rather than vanishing.
 */
export function tabIdForKey(key: string): string {
  const parts = key.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const hit = PREFIX_TO_TAB.get(parts.slice(0, i).join('.'));
    if (hit) return hit;
  }
  return parts[0];
}

/**
 * Resolve a `?tab=` value, which may name a config section from an older link
 * rather than a tab.
 */
export function tabIdForSection(section: string): string {
  return TAB_MANIFEST[section]
    ? section
    : (PREFIX_TO_TAB.get(section) ?? section);
}

/** How many leading path segments every prefix on a tab has in common. */
function sharedDepth(prefixes: string[]): number {
  if (prefixes.length === 0) return 0;
  const first = prefixes[0].split('.');
  let n = 0;
  while (
    n < first.length &&
    prefixes.every((p) => p.split('.')[n] === first[n])
  ) {
    n++;
  }
  return n;
}

/**
 * Card heading path for a setting: the key minus its leaf, minus whatever every
 * prefix on the tab shares. So a tab spanning two sections names them apart,
 * while one carving up a single section doesn't repeat it.
 */
export function cardPath(tabId: string, key: string): string {
  const prefixes = TAB_MANIFEST[tabId]?.sections;
  const parts = key.split('.').slice(0, -1);
  const drop = prefixes ? sharedDepth(prefixes) : 1;
  return parts.slice(drop).join('.');
}

/** Position of a setting's prefix in its tab's declared order. */
export function foldRank(tabId: string, key: string): number {
  const prefixes = TAB_MANIFEST[tabId]?.sections;
  if (!prefixes) return 0;
  const parts = key.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const idx = prefixes.indexOf(parts.slice(0, i).join('.'));
    if (idx !== -1) return idx;
  }
  return prefixes.length;
}

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
  oidc: 'OIDC',
  sso: 'SSO',
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
      order: 9999,
    }
  );
}
