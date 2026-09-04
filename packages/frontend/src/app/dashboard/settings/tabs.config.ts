import type { IconType } from 'react-icons';
import {
  BiBlock,
  BiBox,
  BiCloudDownload,
  BiCog,
  BiFolderOpen,
  BiData,
  BiDownload,
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
/**
 * Show a card or field only while another field holds (`equals`) or does not
 * hold (`not`) a value. The gating key must live on the same tab, since it is
 * read from that tab's form; an unknown key leaves the target visible rather
 * than stranding settings nobody can reach.
 *
 * Hidden does not mean reset: the values still submit, and reverting the gate
 * shows what was there before. So only gate fields whose defaults are valid,
 * or a hidden field can fail validation where nobody can see it.
 *
 * A list means every condition must hold.
 */
export interface Visibility {
  key: string;
  equals?: string | number | boolean;
  not?: string | number | boolean;
}

export type VisibilityRule = Visibility | Visibility[];

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
  /**
   * Config keys rendered by a bespoke editor (see `SETTINGS_EDITORS`) rather
   * than the schema renderer. Those keys are `hidden` in the schema, so they
   * never reach the generic form; their editor saves them itself.
   */
  editors?: string[];
  /**
   * Curated cards for a tab whose section is a flat bag of keys that the
   * automatic subsection grouping would dump into one giant card. Keys are
   * full dotted keys; anything unlisted falls into a trailing "Other" card,
   * so a newly added field is never silently dropped.
   */
  cards?: (
    | {
        title: string;
        note?: string;
        keys: string[];
        /** Render this card only while {@link Visibility} holds. */
        visibleWhen?: VisibilityRule;
      }
    | {
        /**
         * A bespoke editor from {@link TabDef.editors}, placed here rather
         * than after every card: the right slot for one that belongs beside
         * the setting it reports on.
         */
        editor: string;
        visibleWhen?: VisibilityRule;
      }
  )[];
  /**
   * Per-field gates, keyed by full dotted key. Unlike {@link TabDef.cards}
   * this works on any tab, curated or not, and is the right level when one
   * field is meaningless given another's value (a sample size when the depth
   * is `full`, say) rather than a whole card being irrelevant.
   */
  fieldVisibility?: Record<string, VisibilityRule>;
  /**
   * Card gates for auto-grouped tabs, keyed by subsection path (what
   * {@link cardPath} yields). The uncurated counterpart of
   * `cards[].visibleWhen`: without it, a card whose every field is gated
   * away still renders its bare header.
   */
  cardVisibility?: Record<string, VisibilityRule>;
}

/** The recheck detail fields mean nothing until a scope is chosen. */
const RECHECK_ON: Visibility = { key: 'usenet.recheck.scope', not: 'off' };
const RECHECK_FIELDS: Record<string, VisibilityRule> = {
  'usenet.recheck.schedule': RECHECK_ON,
  'usenet.recheck.window': RECHECK_ON,
  'usenet.recheck.depth': RECHECK_ON,
  'usenet.recheck.concurrency': RECHECK_ON,
  'usenet.recheck.batchSize': RECHECK_ON,
  // Also pointless at full depth, where every segment is probed.
  'usenet.recheck.sampleSegments': [
    RECHECK_ON,
    { key: 'usenet.recheck.depth', equals: 'sample' },
  ],
};

/** The hold timeout only matters while the census hold is on. */
const CENSUS_HOLD_FIELDS: Record<string, VisibilityRule> = {
  'usenet.arrCensusHoldTimeout': {
    key: 'usenet.arrWaitForCensus',
    equals: true,
  },
};

/** Each share's own settings only matter once that share is switched on. */
const FUSE_ON: Visibility = { key: 'shares.fuse.enabled', equals: true };
const NFS_ON: Visibility = { key: 'shares.nfs.enabled', equals: true };
const SHARE_FIELDS: Record<string, VisibilityRule> = {
  'shares.fuse.mountPath': FUSE_ON,
  'shares.fuse.allowOther': FUSE_ON,
  'shares.fuse.owner': FUSE_ON,
  'shares.nfs.port': NFS_ON,
  'shares.nfs.bindAddress': NFS_ON,
  'shares.nfs.allowedClients': NFS_ON,
  'shares.nfs.owner': NFS_ON,
};

export const TAB_MANIFEST: Record<string, Omit<TabDef, 'section'>> = {
  // --- the instance itself --------------------------------------------------
  general: {
    label: 'General',
    icon: BiCog,
    group: 'General',
    order: 10,
    sections: ['api', 'templates', 'linkedAccounts'],
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

  // --- the usenet engine, and what only exists because of it ----------------
  usenet: {
    fieldVisibility: { ...RECHECK_FIELDS, ...CENSUS_HOLD_FIELDS },
    label: 'Usenet',
    icon: BiCloudDownload,
    group: 'Usenet',
    order: 160,
    cards: [
      {
        title: 'Performance',
        note: 'Pick a profile and the values below are filled in for you — that is all most setups need. Editing any of the values switches the profile to **custom**.',
        keys: [
          'usenet.performanceProfile',
          'usenet.prefetchSegments',
          'usenet.maxConcurrentDownloads',
          'usenet.segmentDiskCacheBytes',
          'usenet.segmentCacheBytes',
        ],
      },
      {
        title: 'Connections & timeouts',
        keys: [
          'usenet.streamingPriority',
          'usenet.segmentTimeout',
          'usenet.segmentStallTimeout',
          'usenet.dialTimeout',
          'usenet.idleConnection',
          'usenet.streamIdleTimeout',
        ],
      },
      {
        title: 'Reliability',
        keys: [
          'usenet.circuitBreakerThreshold',
          'usenet.circuitBreakerCooldown',
        ],
      },
      {
        title: 'Archive handling',
        keys: ['usenet.lazyRarResolution', 'usenet.strictArchiveMembership'],
      },
      {
        title: 'Verification',
        note:
          'When something is imported, AIOStreams checks that it can actually be downloaded from your providers — so broken or incomplete releases are caught up front instead of failing mid-playback. ' +
          'The checks run alongside the import, so they normally add no waiting time: badly damaged releases are rejected, slightly damaged ones are recorded as “degraded”, and the damage policy decides whether those are still offered as streams. ' +
          'Any checking that did not finish during the import simply continues in the background, and a stream that is already playing is never interrupted by these verdicts. ' +
          'Content verification goes one step further than reachability: it reads the start of each media file and checks it really is the container it claims to be, which catches a release whose articles all exist but were assembled wrong.',
        keys: [
          'usenet.verifyMode',
          'usenet.verifyBudgetMs',
          'usenet.verifyContent',
          'usenet.damagePolicy',
          'usenet.matroskaHoleFill',
          'usenet.censusShadowConcurrency',
          'usenet.censusMaxLifetime',
        ],
      },
      {
        title: 'Import & API',
        keys: [
          'usenet.maxNzbSize',
          'usenet.maxConcurrentInspects',
          'usenet.sabnzbdApiEnabled',
          'usenet.arrWaitForCensus',
          'usenet.arrCensusHoldTimeout',
        ],
      },
      {
        title: 'Library recheck',
        note:
          'Re-verifies entries against your providers on a schedule keyed to how old the post is, so a release that gets taken down after it was added flips to **failed** instead of sitting in the library looking playable. ' +
          'Small damage follows the damage policy above; only a release that is really gone is marked failed and, when a linked Sonarr/Radarr grabbed it, replaced.',
        keys: [
          'usenet.recheck.scope',
          'usenet.recheck.schedule',
          'usenet.recheck.window',
          'usenet.recheck.depth',
          'usenet.recheck.sampleSegments',
          'usenet.recheck.concurrency',
          'usenet.recheck.batchSize',
        ],
      },
    ],
  },
  shares: {
    label: 'Shares',
    icon: BiFolderOpen,
    group: 'Usenet',
    order: 170,
    fieldVisibility: SHARE_FIELDS,
    editors: ['shares.fuse', 'shares.connect'],
    cards: [
      {
        title: 'Mount it here',
        note: `The library is one folder tree; everything below is a different way to reach it. Pick the row that matches your setup.
* **One Linux host, or one Docker stack** — turn the local mount on here and you are done.
* **Sonarr, Radarr or the media server on another Linux machine** — leave this off, switch on the NFS server, and mount that from the other machine.
* **Windows or macOS, or a host you would rather not give mount privileges** — leave this off, keep the WebDAV server on, and mount it there with rclone.
* **Only want to browse or play the files** — point Infuse, VLC or a file manager straight at the WebDAV share; nothing needs mounting at all.`,
        keys: [
          'shares.fuse.enabled',
          'shares.fuse.mountPath',
          'shares.fuse.allowOther',
          'shares.fuse.owner',
        ],
      },
      // Runtime state for the setting directly above it, rather than pushed
      // below every other card on the tab.
      { editor: 'shares.fuse' },
      {
        title: 'WebDAV server',
        keys: ['shares.webdav.enabled'],
      },
      {
        title: 'NFS server',
        keys: [
          'shares.nfs.enabled',
          'shares.nfs.port',
          'shares.nfs.bindAddress',
          'shares.nfs.allowedClients',
          'shares.nfs.owner',
        ],
      },
      {
        title: 'Keeping an rclone mount fresh',
        // Not gated on the local mount being off: an rclone mount on another
        // host is invalidated the same way, and a URL left here keeps working
        // whatever this tab shows; hiding it would strand a live setting.
        note: 'Only needed if you mount the WebDAV share with rclone yourself, wherever that mount runs. Left empty, a finished download stays invisible to that mount until its `--dir-cache-time` expires.',
        keys: [
          'shares.rclone.rcUrl',
          'shares.rclone.rcUser',
          'shares.rclone.rcPass',
        ],
      },
      { editor: 'shares.connect' },
    ],
  },
  arr: {
    label: 'Sonarr / Radarr',
    icon: BiDownload,
    group: 'Usenet',
    order: 180,
    editors: ['arr.instances', 'arr.queueCleanup.rules'],
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
