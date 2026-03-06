export interface Instance {
  /** Unique slug used for tab keys etc. */
  id: string;
  /** Display name */
  name: string;
  /** Handle / username of the host */
  hostedBy?: string;
  /** Profile / org URL for the host */
  hostedByUrl?: string;
  /** Short description shown in the tab body */
  description?: string;
  /** If set, rendered as a warning callout inside the tab */
  warning?: string;
  /**
   * Base URL for the stable channel (no trailing slash).
   * If only this is set, the instance is stable-only.
   */
  stable?: string;
  /**
   * Base URL for the nightly channel (no trailing slash).
   * If only this is set, the instance is nightly-only.
   */
  nightly?: string;
}

export const instances: Instance[] = [
  {
    id: 'elfhosted',
    name: 'ElfHosted',
    hostedBy: 'ElfHosted',
    hostedByUrl: 'https://elfhosted.com',
    description:
      'Hosted by ElfHosted, a well-known and reputable addon hosting service. The most stable option due to being a professional service, but the public instance forcefully excludes P2P, HTTP, and Live stream types. A private instance (no restrictions, relaxed rate limits, direct ElfHosted support) is available for a monthly fee — see the Deployment page.',
    warning:
      'P2P, HTTP, and Live stream types are forcefully excluded on this public instance. If you need those stream types, use a private ElfHosted instance (see the Deployment page), choose a different community instance, or self-host.',
    stable: 'https://aiostreams.elfhosted.com',
  },
  {
    id: 'yeb',
    name: "Yeb's",
    hostedBy: '@nhyyeb',
    hostedByUrl: 'https://fortheweak.cloud',
    description: 'Hosted by an AIOStreams Discord admin.',
    stable: 'https://aiostreams.fortheweak.cloud',
    nightly: 'https://aiostreams-nightly.fortheweak.cloud',
  },
  {
    id: 'midnight',
    name: "Midnight's",
    hostedBy: '@midnightignite',
    hostedByUrl: 'https://addonsfortheweebs.midnightignite.me/addons',
    description: 'Hosted by the TorBox community manager.',
    stable: 'https://aiostreamsfortheweebsstable.midnightignite.me',
    nightly: 'https://aiostreamsfortheweebs.midnightignite.me',
  },
  {
    id: 'viren',
    name: "Viren's",
    hostedBy: '@viren_7',
    hostedByUrl: 'https://github.com/Viren070',
    description:
      'Hosted by the developer. Runs the nightly build — great as a daily driver and for testing new features.',
    nightly: 'https://aiostreams.viren070.me',
  },
  {
    id: 'kuu',
    name: "Kuu's",
    stable: 'https://aiostreams.stremio.ru',
    nightly: 'https://aiostreams-nightly.stremio.ru',
  },
  {
    id: 'atbp',
    name: 'ATBP Hosting',
    stable: 'https://aio.atbphosting.com',
  },
  {
    id: 'omni',
    name: "Omni's",
    hostedBy: '@a.ves',
    stable: 'https://aiostreams.12312023.xyz',
  },
];

/** Returns the primary (preferred) base URL for an instance — stable if available, otherwise nightly. */
export function getPrimaryUrl(instance: Instance): string {
  return instance.stable ?? instance.nightly!;
}
