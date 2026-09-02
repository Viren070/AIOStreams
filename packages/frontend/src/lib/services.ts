import {
  ServiceId,
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
  EASYNEWS_SERVICE,
  STREMTHRU_NEWZ_SERVICE,
  AIOSTREAMS_SERVICE,
} from '../../../core/src/utils/constants';

export const SERVICE_LOGO_MAP: Record<ServiceId, string> = {
  realdebrid: 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/real-debrid.png',
  debridlink: 'https://debrid-link.com/img/brand/dl-white-blue.svg',
  premiumize: 'https://www.premiumize.me/icon_normal.svg',
  alldebrid: 'https://cdn.alldebrid.com/lib/images/default/logo_alldebrid.png',
  torbox: 'https://torbox.app/assets/logo-bb7a9579.svg',
  putio:
    'https://images.seeklogo.com/logo-png/51/1/put-io-logo-png_seeklogo-516681.png',
  pikpak: 'https://mypikpak.com/apple-touch-icon.png',
  offcloud: 'https://offcloud.com/images/logo-blue-short-lg.png',
  seedr: 'https://static.seedr.cc/images/seed_v2.png',
  easydebrid: 'https://paradise-cloud.com/apple-touch-icon.png',
  debrider: 'https://debrider.app/icon.svg',
  easynews: '/assets/easynews_logo.png',
  stremthru_newz: 'https://emojiapi.dev/api/v1/sparkles/256.png',
  stremio_nntp:
    'https://raw.githubusercontent.com/Stremio/stremio-brand/refs/heads/master/logos/PNG/stremio-logo-800px.png',
  nzbdav:
    'https://raw.githubusercontent.com/nzbdav-dev/nzbdav/refs/heads/main/frontend/public/logo.svg',
  altmount:
    'https://raw.githubusercontent.com/javi11/altmount/refs/heads/main/docs/static/img/logo.png',
  aiostreams: '/logo.png',
  torrin: 'https://torrin.app/favicon.png',
};

const USENET_SERVICE_IDS: string[] = [
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
  EASYNEWS_SERVICE,
  STREMTHRU_NEWZ_SERVICE,
  AIOSTREAMS_SERVICE,
];

const DUAL_SERVICE_IDS: string[] = ['torbox'];

export function isUsenetService(id: string): boolean {
  return USENET_SERVICE_IDS.includes(id);
}

export function isDualService(id: string): boolean {
  return DUAL_SERVICE_IDS.includes(id);
}

export type ServiceCategory = 'debrid' | 'usenet' | 'both';

export function serviceCategory(id: string): ServiceCategory {
  if (isDualService(id)) return 'both';
  return isUsenetService(id) ? 'usenet' : 'debrid';
}

/** Section headings for the grouped service pickers, in display order. */
export const SERVICE_GROUPS = [
  { id: 'debrid', label: 'Debrid' },
  { id: 'usenet', label: 'Usenet' },
] as const;

export type ServiceGroupId = (typeof SERVICE_GROUPS)[number]['id'];

/** A dual service is listed under both headings. */
export function serviceInGroup(id: string, group: ServiceGroupId): boolean {
  const category = serviceCategory(id);
  return category === 'both' || category === group;
}
