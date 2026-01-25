import { Option, Resource } from '../db/schemas.js';

export enum ErrorCode {
  // User API
  USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',
  USER_INVALID_DETAILS = 'USER_INVALID_DETAILS',
  USER_INVALID_CONFIG = 'USER_INVALID_CONFIG',
  USER_NEW_PASSWORD_TOO_SHORT = 'USER_NEW_PASSWORD_TOO_SHORT',
  USER_NEW_PASSWORD_TOO_SIMPLE = 'USER_NEW_PASSWORD_TOO_SIMPLE',
  // Database
  DATABASE_ERROR = 'DATABASE_ERROR',
  // Encryption
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
  // Format API
  FORMAT_INVALID_FORMATTER = 'FORMAT_INVALID_FORMATTER',
  FORMAT_INVALID_STREAM = 'FORMAT_INVALID_STREAM',
  FORMAT_ERROR = 'FORMAT_ERROR',
  // Other
  MISSING_REQUIRED_FIELDS = 'MISSING_REQUIRED_FIELDS',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
}

interface ErrorDetails {
  statusCode: number;
  message: string;
}

export const ErrorMap: Record<ErrorCode, ErrorDetails> = {
  [ErrorCode.MISSING_REQUIRED_FIELDS]: {
    statusCode: 400,
    message: 'Required fields are missing',
  },
  [ErrorCode.USER_ALREADY_EXISTS]: {
    statusCode: 409,
    message: 'User already exists',
  },
  [ErrorCode.USER_INVALID_DETAILS]: {
    statusCode: 400,
    message: 'Invalid UUID or password',
  },
  [ErrorCode.USER_INVALID_CONFIG]: {
    statusCode: 400,
    message: 'The config for this user is invalid',
  },
  [ErrorCode.USER_NEW_PASSWORD_TOO_SHORT]: {
    statusCode: 400,
    message: 'New password is too short',
  },
  [ErrorCode.USER_NEW_PASSWORD_TOO_SIMPLE]: {
    statusCode: 400,
    message: 'New password is too simple',
  },
  [ErrorCode.DATABASE_ERROR]: {
    statusCode: 500,
    message: 'A database error occurred',
  },
  [ErrorCode.ENCRYPTION_ERROR]: {
    statusCode: 500,
    message: 'An error occurred in the encryption service',
  },
  [ErrorCode.INTERNAL_SERVER_ERROR]: {
    statusCode: 500,
    message: 'An unexpected error occurred',
  },
  [ErrorCode.METHOD_NOT_ALLOWED]: {
    statusCode: 405,
    message: 'Method not allowed',
  },
  [ErrorCode.RATE_LIMIT_EXCEEDED]: {
    statusCode: 429,
    message: 'Too many requests from this IP, please try again later.',
  },
  [ErrorCode.FORMAT_INVALID_FORMATTER]: {
    statusCode: 400,
    message: 'Invalid formatter',
  },
  [ErrorCode.FORMAT_INVALID_STREAM]: {
    statusCode: 400,
    message: 'Invalid stream',
  },
  [ErrorCode.FORMAT_ERROR]: {
    statusCode: 500,
    message: 'An error occurred while formatting the stream',
  },
  [ErrorCode.BAD_REQUEST]: {
    statusCode: 400,
    message: 'Bad request',
  },
  [ErrorCode.UNAUTHORIZED]: {
    statusCode: 401,
    message: 'Unauthorized',
  },
  [ErrorCode.FORBIDDEN]: {
    statusCode: 403,
    message: 'Forbidden',
  },
};

export class APIError extends Error {
  constructor(
    public code: ErrorCode,
    public statusCode: number = ErrorMap[code].statusCode,
    message?: string
  ) {
    super(message || ErrorMap[code].message);
    this.name = 'APIError';
  }
}

const HEADERS_FOR_IP_FORWARDING = [
  'X-Client-IP',
  'X-Forwarded-For',
  'X-Real-IP',
  'True-Client-IP',
  'X-Forwarded',
  'Forwarded-For',
];

export const INTERNAL_SECRET_HEADER = Buffer.from(
  'WC1BSU9TdHJlYW1zLUludGVybmFsLVNlY3JldA==',
  'base64'
).toString('utf8');

export const PUBLIC_NZB_PROXY_USERNAME = 'public_nzb_proxy_user';

const API_VERSION = 1;

export const REDIS_PREFIX = 'aiostreams:';

export const GDRIVE_FORMATTER = 'gdrive';
export const LIGHT_GDRIVE_FORMATTER = 'lightgdrive';
export const MINIMALISTIC_GDRIVE_FORMATTER = 'minimalisticgdrive';
export const TORRENTIO_FORMATTER = 'torrentio';
export const TORBOX_FORMATTER = 'torbox';
export const PRISM_FORMATTER = 'prism';
export const TAMTARO_FORMATTER = 'tamtaro';
export const CUSTOM_FORMATTER = 'custom';

export const FORMATTERS = [
  GDRIVE_FORMATTER,
  PRISM_FORMATTER,
  TAMTARO_FORMATTER,
  LIGHT_GDRIVE_FORMATTER,
  MINIMALISTIC_GDRIVE_FORMATTER,
  TORRENTIO_FORMATTER,
  TORBOX_FORMATTER,
  CUSTOM_FORMATTER,
] as const;

export type FormatterDetail = {
  id: FormatterType;
  name: string;
  description: string;
};

export const FORMATTER_DETAILS: Record<FormatterType, FormatterDetail> = {
  [GDRIVE_FORMATTER]: {
    id: GDRIVE_FORMATTER,
    name: 'Google Drive',
    description: 'Uses the formatting from the Stremio GDrive addon',
  },
  [PRISM_FORMATTER]: {
    id: PRISM_FORMATTER,
    name: 'Prism',
    description: 'An aesthetic formatter with every detail within 5 lines.',
  },
  [TAMTARO_FORMATTER]: {
    id: TAMTARO_FORMATTER,
    name: 'Tamtaro',
    description:
      "Minimal and clean, without flashy coloured emojis, while comprehensive enough to display all necessary information for stream selection. Smartly switches icons for cached (⚡/⏳), proxied (⛊/⛉), library (☁︎/▤), and season packs (⧉/◧). The last line in small caps font shows Usenet's health status (eg., ☑ ɴᴢʙ), SeaDex status (ᴀʟᴛ/ʙᴇsᴛ ʀᴇʟᴇᴀsᴇ), Vidhin's regex tiers (eg., ʀᴇᴍᴜx ᴛ𝟷), networks (egs., ɴᴇᴛғʟɪx), editions (eg., ᴅɪʀᴇᴄᴛᴏʀ's ᴄᴜᴛ), and special attributes like ʀᴇᴘᴀᴄᴋᴇᴅ, ᴜɴᴄᴇɴsᴏʀᴇᴅ, and ᴜɴʀᴀᴛᴇᴅ.",
  },
  [LIGHT_GDRIVE_FORMATTER]: {
    id: LIGHT_GDRIVE_FORMATTER,
    name: 'Light Google Drive',
    description:
      'A lighter version of the GDrive formatter, focused on asthetics',
  },
  [MINIMALISTIC_GDRIVE_FORMATTER]: {
    id: MINIMALISTIC_GDRIVE_FORMATTER,
    name: 'Minimalistic',
    description: 'A minimalistic formatter which shows only the bare minimum',
  },
  [TORRENTIO_FORMATTER]: {
    id: TORRENTIO_FORMATTER,
    name: 'Torrentio',
    description: 'Uses the formatting from the Torrentio addon',
  },
  [TORBOX_FORMATTER]: {
    id: TORBOX_FORMATTER,
    name: 'Torbox',
    description: 'Uses the formatting from the TorBox Stremio addon',
  },
  [CUSTOM_FORMATTER]: {
    id: CUSTOM_FORMATTER,
    name: 'Custom',
    description: 'Define your own formatter',
  },
};

export type FormatterType = (typeof FORMATTERS)[number];

const REALDEBRID_SERVICE = 'realdebrid';
const DEBRIDLINK_SERVICE = 'debridlink';
const PREMIUMIZE_SERVICE = 'premiumize';
const ALLDEBRID_SERVICE = 'alldebrid';
const TORBOX_SERVICE = 'torbox';
const EASYDEBRID_SERVICE = 'easydebrid';
const DEBRIDER_SERVICE = 'debrider';
const PUTIO_SERVICE = 'putio';
const PIKPAK_SERVICE = 'pikpak';
const OFFCLOUD_SERVICE = 'offcloud';
const SEEDR_SERVICE = 'seedr';
const EASYNEWS_SERVICE = 'easynews';
const NZBDAV_SERVICE = 'nzbdav';
const ALTMOUNT_SERVICE = 'altmount';
const STREMIO_NNTP_SERVICE = 'stremio_nntp';

const SERVICES = [
  REALDEBRID_SERVICE,
  DEBRIDLINK_SERVICE,
  PREMIUMIZE_SERVICE,
  ALLDEBRID_SERVICE,
  TORBOX_SERVICE,
  EASYDEBRID_SERVICE,
  DEBRIDER_SERVICE,
  PUTIO_SERVICE,
  PIKPAK_SERVICE,
  OFFCLOUD_SERVICE,
  SEEDR_SERVICE,
  EASYNEWS_SERVICE,
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
] as const;

export const BUILTIN_SUPPORTED_SERVICES = [
  REALDEBRID_SERVICE,
  DEBRIDLINK_SERVICE,
  PREMIUMIZE_SERVICE,
  ALLDEBRID_SERVICE,
  TORBOX_SERVICE,
  EASYDEBRID_SERVICE,
  DEBRIDER_SERVICE,
  PIKPAK_SERVICE,
  OFFCLOUD_SERVICE,
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
  EASYNEWS_SERVICE,
] as const;

export type ServiceId = (typeof SERVICES)[number];
export type BuiltinServiceId = (typeof BUILTIN_SUPPORTED_SERVICES)[number];

export const MEDIAFLOW_SERVICE = 'mediaflow' as const;
export const STREMTHRU_SERVICE = 'stremthru' as const;
export const BUILTIN_SERVICE = 'builtin' as const;

export const PROXY_SERVICES = [
  BUILTIN_SERVICE,
  STREMTHRU_SERVICE,
  MEDIAFLOW_SERVICE,
] as const;
export type ProxyServiceId = (typeof PROXY_SERVICES)[number];

export const PROXY_SERVICE_DETAILS: Record<
  ProxyServiceId,
  {
    id: ProxyServiceId;
    name: string;
    description: string;
    credentialDescription: string;
  }
> = {
  [BUILTIN_SERVICE]: {
    id: BUILTIN_SERVICE,
    name: 'Builtin Proxy',
    description: 'A proxy service that is built into the core of AIOStreams',
    credentialDescription:
      'A valid username:password pair for this AIOStreams instance, defined in the `AIOSTREAMS_AUTH` environment variable.',
  },
  [STREMTHRU_SERVICE]: {
    id: STREMTHRU_SERVICE,
    name: 'StremThru',
    description:
      '[StremThru](https://github.com/MunifTanjim/stremthru) is a feature packed companion to Stremio which also offers a HTTP proxy, written in Go.',
    credentialDescription:
      'A valid username:password pair for your StremThru instance, defined in the `STREMTHRU_PROXY_AUTH` environment variable.',
  },
  [MEDIAFLOW_SERVICE]: {
    id: MEDIAFLOW_SERVICE,
    name: 'MediaFlow Proxy',
    description:
      '[MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) is a high performance proxy server which supports HTTP, HLS, and more.',
    credentialDescription:
      'The value of your MediaFlow Proxy instance `API_PASSWORD` environment variable.',
  },
};

const SERVICE_DETAILS: Record<
  ServiceId,
  {
    id: ServiceId;
    name: string;
    shortName: string;
    knownNames: string[];
    signUpText: string;
    credentials: Option[];
  }
> = {
  [REALDEBRID_SERVICE]: {
    id: REALDEBRID_SERVICE,
    name: 'Real-Debrid',
    shortName: 'RD',
    knownNames: ['RD', 'Real Debrid', 'RealDebrid', 'Real-Debrid'],
    signUpText:
      "Don't have an account? [Sign up here](https://real-debrid.com/?id=9483829)",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'The API key for the Real-Debrid service. Obtain it from [here](https://real-debrid.com/apitoken)',
        type: 'password',
        required: true,
      },
    ],
  },
  [ALLDEBRID_SERVICE]: {
    id: ALLDEBRID_SERVICE,
    name: 'AllDebrid',
    shortName: 'AD',
    knownNames: ['AD', 'All Debrid', 'AllDebrid', 'All-Debrid'],
    signUpText:
      "Don't have an account? [Sign up here](https://alldebrid.com/?uid=3n8qa&lang=en)",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'The API key for the All-Debrid service. Create one [here](https://alldebrid.com/apikeys)',
        type: 'password',
        required: true,
      },
    ],
  },
  [PREMIUMIZE_SERVICE]: {
    id: PREMIUMIZE_SERVICE,
    name: 'Premiumize',
    shortName: 'PM',
    knownNames: ['PM', 'Premiumize'],
    signUpText:
      "Don't have an account? [Sign up here](https://www.premiumize.me/register)",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'Your Premiumize API key. Obtain it from [here](https://www.premiumize.me/account)',
        type: 'password',
        required: true,
      },
    ],
  },
  [DEBRIDLINK_SERVICE]: {
    id: DEBRIDLINK_SERVICE,
    name: 'Debrid-Link',
    shortName: 'DL',
    knownNames: ['DL', 'Debrid Link', 'DebridLink', 'Debrid-Link'],
    signUpText:
      "Don't have an account? [Sign up here](https://debrid-link.com/id/EY0JO)",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'Your Debrid-Link API key. Obtain it from [here](https://debrid-link.com/webapp/apikey)',
        type: 'password',
        required: true,
      },
    ],
  },
  [TORBOX_SERVICE]: {
    id: TORBOX_SERVICE,
    name: 'TorBox',
    shortName: 'TB',
    knownNames: ['TB', 'TorBox', 'Torbox', 'TRB'],
    signUpText:
      "Don't have an account? [Sign up here](https://torbox.app/subscription?referral=9ca21adb-dbcb-4fb0-9195-412a5f3519bc) or use my referral code `9ca21adb-dbcb-4fb0-9195-412a5f3519bc`.",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'Your Torbox API key. Obtain it from [here](https://torbox.app/settings)',
        type: 'password',
        required: true,
      },
    ],
  },
  [STREMIO_NNTP_SERVICE]: {
    id: STREMIO_NNTP_SERVICE,
    name: 'Stremio NNTP',
    shortName: 'SN',
    knownNames: ['SN', 'Stremio NNTP', 'StremioNntp', 'Stremio-NNTP'],
    signUpText:
      "Stream usenet directly from your provider via Stremio's NNTP client.",
    credentials: [
      {
        id: 'note',
        name: '',
        description: `This is a new Stremio feature that allows Stremio to connect directly to Usenet NNTP servers you provide. It is currently [only supported on Stremio V5 Desktop](https://blog.stremio.com/stremio-new-stream-sources-usenet-rar-zip-ftp-and-more/).`,
        type: 'alert',
        intent: 'warning',
      },
      {
        id: 'servers',
        name: 'NNTP Servers',
        description: 'Provide your Usenet NNTP server addresses',
        type: 'custom-nntp-servers',
        required: true,
      },
    ],
  },
  [NZBDAV_SERVICE]: {
    id: NZBDAV_SERVICE,
    name: 'NzbDAV',
    shortName: 'ND',
    knownNames: ['ND'],
    signUpText: 'Stream usenet directly from your provider via Nzb DAV.',
    credentials: [
      {
        id: 'note',
        name: 'Configuration Help',
        description: `**URL:** Use internal URL for local setups (e.g., http://nzbdav:3000), otherwise use a public URL.\n\n**Public URL:** Only needed if URL is local but streams need to be publicly accessible. Leave blank if URL is public or using a proxy.\n\n**Security Note:** WebDAV credentials are exposed in stream URLs unless proxied. To proxy, provide the Auth Token below (built-in proxy only).\n\nFor detailed setup instructions, see the [Usenet Wiki](https://github.com/Viren070/AIOStreams/wiki/Usenet#configuring-the-service-in-aiostreams).`,
        type: 'alert',
        intent: 'info',
        required: false,
      },
      {
        id: 'url',
        name: 'NzbDAV URL',
        description:
          'The base URL of your NZB DAV instance. E.g., http://nzbdav:3000',
        type: 'string',
        required: true,
      },
      {
        id: 'publicUrl',
        name: 'Public NzbDAV URL (Optional)',
        description:
          'The public URL of your NzbDAV instance. Optional, see note above for details.',
        type: 'string',
        required: false,
      },
      {
        id: 'apiKey',
        name: 'NzbDAV API Key',
        description:
          'Your Nzb DAV API Key, found in the SABnzbd section in settings.',
        type: 'password',
        required: true,
      },
      {
        id: 'username',
        name: 'NzbDAV WebDAV Username',
        description:
          'Your Nzb DAV WebDAV Username. Found in the WebDAV section in settings.',
        type: 'string',
        required: false,
      },
      {
        id: 'password',
        name: 'NzbDAV WebDAV Password',
        description:
          'Your NzbDAV WebDAV Password. Found in the WebDAV section in settings.',
        type: 'password',
        required: false,
      },
      {
        id: 'aiostreamsAuth',
        name: 'AIOStreams Auth Token (Optional)',
        description:
          'If you would like to proxy your NzbDAV streams, you will need to provide a username:password pair for your AIOStreams instance, defined in the `AIOSTREAMS_AUTH` environment variable. **Other proxies will not work and you must define it here only**',
        type: 'password',
        required: false,
      },
    ],
  },
  [ALTMOUNT_SERVICE]: {
    id: ALTMOUNT_SERVICE,
    name: 'AltMount',
    shortName: 'AM',
    knownNames: ['AM'],
    signUpText: 'Stream usenet directly from your provider via AltMount.',
    credentials: [
      {
        id: 'note',
        name: 'Configuration Help',
        description: `**URL:** Use internal URL for local setups (e.g., http://altmount:8000), otherwise use a public URL.\n\n**Public URL:** Only needed if URL is local but streams need to be publicly accessible. Leave blank if URL is public or using a proxy.\n\n**Security Note:** WebDAV credentials are exposed in stream URLs unless proxied. To proxy, provide the Auth Token below (built-in proxy only).\n\nFor detailed setup instructions, see the [Usenet Wiki](https://github.com/Viren070/AIOStreams/wiki/Usenet#configuring-the-service-in-aiostreams).`,
        type: 'alert',
        intent: 'info',
        required: false,
      },
      {
        id: 'url',
        name: 'Altmount URL',
        description:
          'The base URL of your AltMount instance used for requests. e.g., http://altmount:8080',
        type: 'string',
        required: true,
      },
      {
        id: 'publicUrl',
        name: 'Public Altmount URL',
        description:
          'The public URL of your AltMount instance. Optional, see note above for details.',
        type: 'string',
        required: false,
      },
      {
        id: 'apiKey',
        name: 'AltMount API Key',
        description:
          'Your AltMount API Key, found at `Configuration -> System` in the AltMount Web UI.',
        type: 'password',
        required: true,
      },
      {
        id: 'username',
        name: 'AltMount WebDAV Username',
        description:
          'Your AltMount WebDAV Username, found at `Configuration -> WebDAV Server` in the AltMount Web UI.',
        type: 'string',
        required: true,
      },
      {
        id: 'password',
        name: 'AltMount WebDAV Password',
        description:
          'Your AltMount WebDAV Password, found at `Configuration -> WebDAV Server` in the AltMount Web UI.',
        type: 'password',
        required: true,
      },
      {
        id: 'aiostreamsAuth',
        name: 'AIOStreams Auth Token (Optional)',
        description:
          'If you would like to proxy your AltMount streams, you will need to provide a username:password pair for your AIOStreams instance, defined in the `AIOSTREAMS_AUTH` environment variable. **Other proxies will not work and you must define it here only**',
        type: 'password',
        required: false,
      },
    ],
  },

  [OFFCLOUD_SERVICE]: {
    id: OFFCLOUD_SERVICE,
    name: 'Offcloud',
    shortName: 'OC',
    knownNames: ['OC', 'Offcloud'],
    signUpText:
      "Don't have an account? [Sign up here](https://offcloud.com/?=06202a3d)",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'Your Offcloud API key. Obtain it from [here](https://offcloud.com/#/account) on the `API Key` tab. ',
        type: 'password',
        required: true,
      },
      {
        id: 'email',
        name: 'Email',
        description:
          'Your Offcloud email. (These credentials are necessary for some addons)',
        type: 'password',
        required: true,
      },
      {
        id: 'password',
        name: 'Password',
        description:
          'Your Offcloud password. (These credentials are necessary for some addons)',
        type: 'password',
        required: true,
      },
    ],
  },
  [PUTIO_SERVICE]: {
    id: PUTIO_SERVICE,
    name: 'put.io',
    shortName: 'P.IO',
    knownNames: ['PO', 'put.io', 'putio'],
    signUpText: "Don't have an account? [Sign up here](https://put.io/)",
    credentials: [
      {
        id: 'clientId',
        name: 'Client ID',
        description:
          'Your put.io Client ID. Obtain it from [here](https://app.put.io/oauth)',
        type: 'password',
        required: true,
      },
      {
        id: 'token',
        name: 'Token',
        description:
          'Your put.io Token. Obtain it from [here](https://app.put.io/oauth)',
        type: 'password',
        required: true,
      },
    ],
  },
  [EASYNEWS_SERVICE]: {
    id: EASYNEWS_SERVICE,
    name: 'Easynews',
    shortName: 'EN',
    knownNames: ['EN', 'Easynews'],
    signUpText:
      "Don't have an account? [Sign up here](https://www.easynews.com/)",
    credentials: [
      {
        id: 'username',
        name: 'Username',
        description: 'Your Easynews username',
        type: 'password',
        required: true,
      },
      {
        id: 'password',
        name: 'Password',
        description: 'Your Easynews password',
        type: 'password',
        required: true,
      },
    ],
  },
  [EASYDEBRID_SERVICE]: {
    id: EASYDEBRID_SERVICE,
    name: 'EasyDebrid',
    shortName: 'ED',
    knownNames: ['ED', 'EasyDebrid'],
    signUpText:
      "Don't have an account? [Sign up here](https://paradise-cloud.com/products/easydebrid)",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'Your EasyDebrid API key. Obtain it from [here](https://paradise-cloud.com/dashboard/)',
        type: 'password',
        required: true,
      },
    ],
  },
  [DEBRIDER_SERVICE]: {
    id: DEBRIDER_SERVICE,
    name: 'Debrider',
    shortName: 'DR',
    knownNames: ['DBD', 'DR', 'DER', 'DB', 'Debrider'],
    signUpText: "Don't have an account? [Sign up here](https://debrider.app/)",
    credentials: [
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'Your Debrider API key. Obtain it from [here](https://debrider.app/dashboard/account)',
        type: 'password',
        required: true,
      },
    ],
  },
  [PIKPAK_SERVICE]: {
    id: PIKPAK_SERVICE,
    name: 'PikPak',
    shortName: 'PKP',
    knownNames: ['PP', 'PikPak', 'PKP'],
    signUpText:
      "Don't have an account? [Sign up here](https://mypikpak.com/drive/activity/invited?invitation-code=72822731)",
    credentials: [
      {
        id: 'email',
        name: 'Email',
        description: 'Your PikPak email address',
        type: 'password',
        required: true,
      },
      {
        id: 'password',
        name: 'Password',
        description: 'Your PikPak password',
        type: 'password',
        required: true,
      },
    ],
  },
  [SEEDR_SERVICE]: {
    id: SEEDR_SERVICE,
    name: 'Seedr',
    shortName: 'SDR',
    knownNames: ['SR', 'Seedr', 'SDR'],
    signUpText:
      "Don't have an account? [Sign up here](https://www.seedr.cc/?r=6542079)",
    credentials: [
      {
        id: 'encodedToken',
        name: 'Encoded Token',
        description:
          'Please authorise at MediaFusion and copy the token into here.',
        type: 'password',
        required: true,
      },
    ],
  },
};

const TOP_LEVEL_OPTION_DETAILS: Record<
  | 'tmdbApiKey'
  | 'tmdbAccessToken'
  | 'rpdbApiKey'
  | 'tvdbApiKey'
  | 'topPosterApiKey',
  {
    name: string;
    description: string;
  }
> = {
  tmdbApiKey: {
    name: 'TMDB API Key',
    description:
      'Get your free API key from [here](https://www.themoviedb.org/settings/api). Make sure to copy the 32 character API Key and not the Read Access Token.',
  },
  tmdbAccessToken: {
    name: 'TMDB Access Token',
    description:
      'Get your free access token from [here](https://www.themoviedb.org/settings/api). Make sure to copy the Read Access Token and not the 32 character API Key.',
  },
  rpdbApiKey: {
    name: 'RPDB API Key',
    description:
      'Get your free API key from [here](https://ratingposterdb.com/api-key/) for posters with ratings.',
  },
  topPosterApiKey: {
    name: 'Top Poster API Key',
    description:
      'Get your free API key from [here](https://api.top-streaming.stream/user/register) for posters with ratings.',
  },
  tvdbApiKey: {
    name: 'TVDB API Key',
    description:
      'Sign up for a free API Key at [TVDB](https://www.thetvdb.com/api-information) and then get it from your [dashboard](https://www.thetvdb.com/dashboard/account/apikeys).',
  },
};

export const DEDUPLICATOR_KEYS = [
  'filename',
  'infoHash',
  'smartDetect',
] as const;

export const AUTO_PLAY_ATTRIBUTES = [
  'service',
  'addon',
  'proxied',
  'resolution',
  'quality',
  'encode',
  'audioTags',
  'visualTags',
  'languages',
  'releaseGroup',
  'type',
  'infoHash',
  'size',
] as const;

export const DEFAULT_AUTO_PLAY_ATTRIBUTES: (typeof AUTO_PLAY_ATTRIBUTES)[number][] =
  ['resolution', 'quality', 'releaseGroup'] as const;

export const AUTO_PLAY_METHODS = [
  'matchingFile',
  'matchingIndex',
  'firstFile',
] as const;
export type AutoPlayMethod = (typeof AUTO_PLAY_METHODS)[number];
export const AUTO_PLAY_METHOD_DETAILS: Record<
  AutoPlayMethod,
  {
    name: string;
    description: string;
  }
> = {
  matchingFile: {
    name: 'Matching File',
    description:
      'Auto-play the stream that matches the (customisable) attributes of the previous episode.',
  },
  matchingIndex: {
    name: 'Matching Index',
    description:
      'Auto-play the stream in the same position in the result list (assuming it exists) i.e. if you play the second stream, the second stream for the next episode will also be played.',
  },
  firstFile: {
    name: 'First File',
    description: 'Always auto-play the first stream in the result list.',
  },
} as const;

const RESOLUTIONS = [
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  '360p',
  '240p',
  '144p',
  'Unknown',
] as const;

const QUALITIES = [
  'BluRay REMUX',
  'BluRay',
  'WEB-DL',
  'WEBRip',
  'HDRip',
  'HC HD-Rip',
  'DVDRip',
  'HDTV',
  'CAM',
  'TS',
  'TC',
  'SCR',
  'Unknown',
] as const;

export const FAKE_VISUAL_TAGS = ['HDR+DV', 'DV Only', 'HDR Only'] as const;
export type FakeVisualTag = (typeof FAKE_VISUAL_TAGS)[number];

const VISUAL_TAGS = [
  ...FAKE_VISUAL_TAGS,
  'HDR10+',
  'HDR10',
  'DV',
  'HDR',
  'HLG',
  '10bit',
  '3D',
  'IMAX',
  'AI',
  'SDR',
  'H-OU',
  'H-SBS',
  'Unknown',
] as const;

const AUDIO_TAGS = [
  'Atmos',
  'DD+',
  'DD',
  'DTS:X',
  'DTS-HD MA',
  'DTS-HD',
  'DTS-ES',
  'DTS',
  'TrueHD',
  'OPUS',
  'FLAC',
  'AAC',
  'Unknown',
] as const;

const AUDIO_CHANNELS = ['2.0', '5.1', '6.1', '7.1', 'Unknown'] as const;

// Passthrough stages that can be selectively bypassed
const PASSTHROUGH_STAGES = [
  'filter', // bypass main filtering (shouldKeepStream)
  'language', // bypass language filtering specifically
  'dedup', // bypass deduplication
  'limit', // bypass result limiting
  'excluded', // bypass excluded stream expressions
  'required', // bypass required stream expressions
  'title', // bypass title matching
  'year', // bypass year matching
  'episode', // bypass season/episode matching
  'digitalRelease', // bypass early digital release filter
] as const;

const ENCODES = [
  'AV1',
  'HEVC',
  'AVC',
  'XviD',
  'DivX',
  // 'H-OU',
  // 'H-SBS',
  'Unknown',
] as const;

const SORT_CRITERIA = [
  'quality',
  'resolution',
  'language',
  'visualTag',
  'audioTag',
  'audioChannel',
  'streamType',
  'encode',
  'size',
  'service',
  'seeders',
  'private',
  'age',
  'addon',
  'regexPatterns',
  'cached',
  'library',
  'keyword',
  'streamExpressionMatched',
  'seadex',
  'bitrate',
] as const;

export const MIN_SIZE = 0;
export const MAX_SIZE = 100 * 1000 * 1000 * 1000; // 100GB

export const MIN_BITRATE = 0;
export const MAX_BITRATE = 250 * 1000 * 1000; // 250 Mbps

export const MIN_SEEDERS = 0;
export const MAX_SEEDERS = 1000;

export const MIN_AGE_HOURS = 0;
export const MAX_AGE_HOURS = 6480 * 24; // 6480 days (approx 18 years)

export const DEFAULT_POSTERS = [
  'aHR0cHM6Ly93d3cucG5nbWFydC5jb20vZmlsZXMvMTEvUmlja3JvbGxpbmctUE5HLVBpYy5wbmc=',
];

export const DEFAULT_YT_ID = 'eHZGWmpvNVBnRzA=';

export const SORT_CRITERIA_DETAILS: Record<
  (typeof SORT_CRITERIA)[number],
  {
    name: string;
    description: string;
    defaultDirection: 'asc' | 'desc';
    ascendingDescription: string;
    descendingDescription: string;
  }
> = {
  quality: {
    name: 'Quality',
    description: 'Sort by the quality of the stream',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred quality list are preferred',
    descendingDescription:
      'Streams that are in your preferred quality list are preferred',
  },
  resolution: {
    name: 'Resolution',
    description: 'Sort by the resolution of the stream',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred resolution list are preferred',
    descendingDescription:
      'Streams that are in your preferred resolution list are preferred',
  },
  language: {
    name: 'Language',
    description: 'Sort by the language of the stream',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred language list are preferred',
    descendingDescription:
      'Streams that are in your preferred language list are preferred',
  },
  visualTag: {
    name: 'Visual Tag',
    description: 'Sort by the visual tags of the stream',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred visual tag list are preferred',
    descendingDescription:
      'Streams that are in your preferred visual tag list are preferred',
  },
  audioTag: {
    name: 'Audio Tag',
    description: 'Sort by the audio tags of the stream',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred audio tag list are preferred',
    descendingDescription:
      'Streams that are in your preferred audio tag list are preferred',
  },
  audioChannel: {
    name: 'Audio Channel',
    description: 'Sort by the audio channels of the stream',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred audio channel list are preferred',
    descendingDescription:
      'Streams that are in your preferred audio channel list are preferred',
  },
  streamType: {
    name: 'Stream Type',
    description: 'Whether the stream is of a preferred stream type',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred stream type list are preferred',
    descendingDescription:
      'Streams that are in your preferred stream type list are preferred',
  },
  encode: {
    name: 'Encode',
    description: 'Whether the stream is of a preferred encode',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not in your preferred encode list are preferred',
    descendingDescription:
      'Streams that are in your preferred encode list are preferred',
  },
  size: {
    name: 'Size',
    description: 'Sort by the size of the stream',
    defaultDirection: 'desc',
    ascendingDescription: 'Streams that are smaller are sorted first',
    descendingDescription: 'Streams that are larger are sorted first',
  },
  service: {
    name: 'Service',
    description: 'Sort by the service order',
    defaultDirection: 'desc',
    ascendingDescription: 'Streams without a service are preferred',
    descendingDescription:
      'Streams are ordered by the order of your service list, with non-service streams at the bottom',
  },
  seeders: {
    name: 'Seeders',
    description: 'Sort by the number of seeders',
    defaultDirection: 'desc',
    ascendingDescription: 'Streams with fewer seeders are preferred',
    descendingDescription: 'Streams with more seeders are preferred',
  },
  private: {
    name: 'Private',
    description: 'Whether the stream is from a private tracker or not',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that are not from private trackers are preferred',
    descendingDescription:
      'Streams that are from private trackers are preferred',
  },
  age: {
    name: 'Age',
    description: 'Sort by the age of the stream',
    defaultDirection: 'desc',
    ascendingDescription: 'Newer streams are preferred',
    descendingDescription: 'Older streams are preferred',
  },
  addon: {
    name: 'Addon',
    description: 'Sort by the addon order',
    defaultDirection: 'desc',
    ascendingDescription: 'Streams are sorted by the order of your addon list',
    descendingDescription: 'Streams are sorted by the order of your addon list',
  },
  regexPatterns: {
    name: 'Regex Patterns',
    description:
      'Whether the stream matches any of your preferred regex patterns',
    defaultDirection: 'desc',
    ascendingDescription:
      'Streams that do not match your preferred regex patterns are preferred',
    descendingDescription:
      'Streams that match your preferred regex patterns are preferred',
  },
  cached: {
    name: 'Cached',
    defaultDirection: 'desc',
    description: 'Whether the stream is cached or not',
    ascendingDescription: 'Streams that are not cached are preferred',
    descendingDescription: 'Streams that are cached are preferred',
  },
  library: {
    name: 'Library',
    defaultDirection: 'desc',
    description:
      'Whether the stream is in your library (e.g. debrid account) or not',
    ascendingDescription: 'Streams that are not in your library are preferred',
    descendingDescription: 'Streams that are in your library are preferred',
  },
  keyword: {
    name: 'Keyword',
    defaultDirection: 'desc',
    description: 'Sort by the keyword of the stream',
    ascendingDescription:
      'Streams that do not match any of your keywords are preferred',
    descendingDescription:
      'Streams that match any of your keywords are preferred',
  },
  streamExpressionMatched: {
    name: 'Stream Expression Matched',
    defaultDirection: 'desc',
    description: 'Whether the stream matches any of your stream expressions',
    ascendingDescription:
      'Streams that do not match your stream expressions are preferred while the ones that do are ranked by the order of your stream expressions',
    descendingDescription:
      'Streams that match your stream expressions are preferred and ranked by the order of your stream expressions',
  },
  seadex: {
    name: 'SeaDex',
    defaultDirection: 'desc',
    description:
      'Whether the stream is a SeaDex release (curated best anime releases from releases.moe)',
    ascendingDescription: 'Streams that are not listed on SeaDex are preferred',
    descendingDescription:
      'Streams that are marked as the Best release on SeaDex are preferred, followed by the Alternative release',
  },
  bitrate: {
    name: 'Bitrate (Estimate)',
    defaultDirection: 'desc',
    description: 'Sort by the bitrate of the stream',
    ascendingDescription: 'Streams with lower bitrate are preferred',
    descendingDescription: 'Streams with higher bitrate are preferred',
  },
} as const;

const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export const P2P_STREAM_TYPE = 'p2p' as const;
export const LIVE_STREAM_TYPE = 'live' as const;
export const STREMIO_USENET_STREAM_TYPE = 'stremio-usenet' as const;
export const ARCHIVE_STREAM_TYPE = 'archive' as const;
export const USENET_STREAM_TYPE = 'usenet' as const;
export const DEBRID_STREAM_TYPE = 'debrid' as const;
export const HTTP_STREAM_TYPE = 'http' as const;
export const EXTERNAL_STREAM_TYPE = 'external' as const;
export const YOUTUBE_STREAM_TYPE = 'youtube' as const;
export const ERROR_STREAM_TYPE = 'error' as const;
export const STATISTIC_STREAM_TYPE = 'statistic' as const;

const STREAM_TYPES = [
  P2P_STREAM_TYPE,
  LIVE_STREAM_TYPE,
  STREMIO_USENET_STREAM_TYPE,
  ARCHIVE_STREAM_TYPE,
  USENET_STREAM_TYPE,
  DEBRID_STREAM_TYPE,
  HTTP_STREAM_TYPE,
  EXTERNAL_STREAM_TYPE,
  YOUTUBE_STREAM_TYPE,
  ERROR_STREAM_TYPE,
  STATISTIC_STREAM_TYPE,
] as const;

export type StreamType = (typeof STREAM_TYPES)[number];

const STREAM_RESOURCE = 'stream' as const;
const SUBTITLES_RESOURCE = 'subtitles' as const;
const CATALOG_RESOURCE = 'catalog' as const;
const META_RESOURCE = 'meta' as const;
const ADDON_CATALOG_RESOURCE = 'addon_catalog' as const;

export const MOVIE_TYPE = 'movie' as const;
export const SERIES_TYPE = 'series' as const;
export const CHANNEL_TYPE = 'channel' as const;
export const TV_TYPE = 'tv' as const;
export const ANIME_TYPE = 'anime' as const;

export const TYPES = [
  MOVIE_TYPE,
  SERIES_TYPE,
  CHANNEL_TYPE,
  TV_TYPE,
  ANIME_TYPE,
] as const;

export const TYPE_LABELS: Record<(typeof TYPES)[number], string> = {
  [MOVIE_TYPE]: 'Movie',
  [SERIES_TYPE]: 'Series',
  [CHANNEL_TYPE]: 'Channel',
  [TV_TYPE]: 'TV',
  [ANIME_TYPE]: 'Anime',
};

const RESOURCES = [
  STREAM_RESOURCE,
  SUBTITLES_RESOURCE,
  CATALOG_RESOURCE,
  META_RESOURCE,
  ADDON_CATALOG_RESOURCE,
] as const;

export const RESOURCE_LABELS: Record<Resource, string> = {
  [STREAM_RESOURCE]: 'Stream',
  [SUBTITLES_RESOURCE]: 'Subtitles',
  [CATALOG_RESOURCE]: 'Catalog',
  [META_RESOURCE]: 'Metadata',
  [ADDON_CATALOG_RESOURCE]: 'Addon Catalog',
};

// export const PRESET_CATEGORY_STREAMS = 'streams' as const;
// econst PRESET_CATEGORY_SUBTITLES = 'subtitles' as const;
// const PRESET_CATEGORY_META_CATALOGS = 'meta_catalogs' as const;
// const PRESET_CATEGORY_MISC = 'misc' as const;
export enum PresetCategory {
  STREAMS = 'streams',
  SUBTITLES = 'subtitles',
  META_CATALOGS = 'meta_catalogs',
  MISC = 'misc',
}

export const PRESET_CATEGORIES = [
  PresetCategory.STREAMS,
  PresetCategory.SUBTITLES,
  PresetCategory.META_CATALOGS,
  PresetCategory.MISC,
] as const;

const LANGUAGES = [
  'English',
  'Japanese',
  'Chinese',
  'Russian',
  'Arabic',
  'Portuguese',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Korean',
  'Hindi',
  'Bengali',
  'Punjabi',
  'Marathi',
  'Gujarati',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Thai',
  'Vietnamese',
  'Indonesian',
  'Turkish',
  'Hebrew',
  'Persian',
  'Ukrainian',
  'Greek',
  'Lithuanian',
  'Latvian',
  'Estonian',
  'Polish',
  'Czech',
  'Slovak',
  'Hungarian',
  'Romanian',
  'Bulgarian',
  'Serbian',
  'Croatian',
  'Slovenian',
  'Dutch',
  'Danish',
  'Finnish',
  'Swedish',
  'Norwegian',
  'Malay',
  'Latino',
  'Dual Audio',
  'Dubbed',
  'Multi',
  'Original',
  'Unknown',
] as const;

export const SNIPPETS = [
  {
    name: 'Year + Season + Episode',
    description:
      'Outputs a nicely formatted year along with the season and episode number',
    value:
      '{stream.year::exists["({stream.year}) "||""]}{stream.seasonEpisode::exists["{stream.seasonEpisode::join(\' • \')}"||""]}',
  },
  {
    name: 'File Size',
    description: 'Outputs the file size of the stream',
    value: '{stream.size::>0["{stream.size::bytes}"||""]}',
  },
  {
    name: 'Duration',
    description: 'Outputs the duration of the stream',
    value: '{stream.duration::>0["{stream.duration::time}"||""]}',
  },
  {
    name: 'P2P marker',
    description: 'Displays a [P2P] marker if the stream is a P2P stream',
    value: '{stream.type::=p2p["[P2P]"||""]}',
  },
  {
    name: 'Languages',
    description:
      'Outputs the languages of the stream. Tip: use stream.languageEmojis if you prefer the flags',
    value:
      '{stream.languages::exists["{stream.languages::join(\' • \')}"||""]}',
  },
];

export {
  API_VERSION,
  SERVICES,
  RESOLUTIONS,
  QUALITIES,
  VISUAL_TAGS,
  AUDIO_TAGS,
  AUDIO_CHANNELS,
  ENCODES,
  PASSTHROUGH_STAGES,
  SORT_CRITERIA,
  SORT_DIRECTIONS,
  STREAM_TYPES,
  LANGUAGES,
  RESOURCES,
  STREAM_RESOURCE,
  SUBTITLES_RESOURCE,
  CATALOG_RESOURCE,
  META_RESOURCE,
  ADDON_CATALOG_RESOURCE,
  REALDEBRID_SERVICE,
  PREMIUMIZE_SERVICE,
  ALLDEBRID_SERVICE,
  DEBRIDLINK_SERVICE,
  TORBOX_SERVICE,
  EASYDEBRID_SERVICE,
  DEBRIDER_SERVICE,
  PUTIO_SERVICE,
  PIKPAK_SERVICE,
  OFFCLOUD_SERVICE,
  SEEDR_SERVICE,
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
  EASYNEWS_SERVICE,
  SERVICE_DETAILS,
  TOP_LEVEL_OPTION_DETAILS,
  HEADERS_FOR_IP_FORWARDING,
};
