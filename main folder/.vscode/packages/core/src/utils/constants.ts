import { Option } from '../db';

export enum ErrorCode {
  // User API
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',
  USER_INVALID_PASSWORD = 'USER_INVALID_PASSWORD',
  USER_INVALID_CONFIG = 'USER_INVALID_CONFIG',
  USER_ERROR = 'USER_ERROR',
  USER_NEW_PASSWORD_TOO_SHORT = 'USER_NEW_PASSWORD_TOO_SHORT',
  USER_NEW_PASSWORD_TOO_SIMPLE = 'USER_NEW_PASSWORD_TOO_SIMPLE',
  // Format API
  FORMAT_INVALID_FORMATTER = 'FORMAT_INVALID_FORMATTER',
  FORMAT_INVALID_STREAM = 'FORMAT_INVALID_STREAM',
  FORMAT_ERROR = 'FORMAT_ERROR',
  // Other
  MISSING_REQUIRED_FIELDS = 'MISSING_REQUIRED_FIELDS',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
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
  [ErrorCode.USER_NOT_FOUND]: {
    statusCode: 404,
    message: 'User not found',
  },
  [ErrorCode.USER_ALREADY_EXISTS]: {
    statusCode: 409,
    message: 'User already exists',
  },
  [ErrorCode.USER_INVALID_PASSWORD]: {
    statusCode: 401,
    message: 'Invalid password',
  },
  [ErrorCode.USER_INVALID_CONFIG]: {
    statusCode: 400,
    message: 'The config for this user is invalid',
  },
  [ErrorCode.USER_ERROR]: {
    statusCode: 500,
    message: 'A generic error while processing the user request',
  },
  [ErrorCode.USER_NEW_PASSWORD_TOO_SHORT]: {
    statusCode: 400,
    message: 'New password is too short',
  },
  [ErrorCode.USER_NEW_PASSWORD_TOO_SIMPLE]: {
    statusCode: 400,
    message: 'New password is too simple',
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

const API_VERSION = 1;

export const GDRIVE_FORMATTER = 'gdrive';
export const LIGHT_GDRIVE_FORMATTER = 'lightgdrive';
export const MINIMALISTIC_GDRIVE_FORMATTER = 'minimalisticgdrive';
export const TORRENTIO_FORMATTER = 'torrentio';
export const TORBOX_FORMATTER = 'torbox';
export const CUSTOM_FORMATTER = 'custom';

export const FORMATTERS = [
  GDRIVE_FORMATTER,
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
  [LIGHT_GDRIVE_FORMATTER]: {
    id: LIGHT_GDRIVE_FORMATTER,
    name: 'Light Google Drive',
    description:
      'A lighter version of the GDrive formatter, focused on asthetics',
  },
  [MINIMALISTIC_GDRIVE_FORMATTER]: {
    id: MINIMALISTIC_GDRIVE_FORMATTER,
    name: 'Minimalistic Google Drive',
    description:
      'A minimalistic formatter for Google Drive which shows only the bare minimum',
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
const ALLEDEBRID_SERVICE = 'alldebrid';
const TORBOX_SERVICE = 'torbox';
const EASYDEBRID_SERVICE = 'easydebrid';
const PUTIO_SERVICE = 'putio';
const PIKPAK_SERVICE = 'pikpak';
const OFFCLOUD_SERVICE = 'offcloud';
const SEEDR_SERVICE = 'seedr';
const EASYNEWS_SERVICE = 'easynews';

const SERVICES = [
  REALDEBRID_SERVICE,
  DEBRIDLINK_SERVICE,
  PREMIUMIZE_SERVICE,
  ALLEDEBRID_SERVICE,
  TORBOX_SERVICE,
  EASYDEBRID_SERVICE,
  PUTIO_SERVICE,
  PIKPAK_SERVICE,
  OFFCLOUD_SERVICE,
  SEEDR_SERVICE,
  EASYNEWS_SERVICE,
] as const;

export type ServiceId = (typeof SERVICES)[number];

export const MEDIAFLOW_SERVICE = 'mediaflow' as const;
export const STREMTHRU_SERVICE = 'stremthru' as const;

export const PROXY_SERVICES = [MEDIAFLOW_SERVICE, STREMTHRU_SERVICE] as const;
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
  [MEDIAFLOW_SERVICE]: {
    id: MEDIAFLOW_SERVICE,
    name: 'MediaFlow Proxy',
    description:
      '[MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) is a high performance proxy server which supports HTTP, HLS, and more.',
    credentialDescription:
      'The value of your MediaFlow Proxy instance `API_PASSWORD` environment variable.',
  },
  [STREMTHRU_SERVICE]: {
    id: STREMTHRU_SERVICE,
    name: 'StremThru',
    description:
      '[StremThru](https://github.com/MunifTanjim/stremthru) is a feature packed companion to Stremio which also offers a HTTP proxy, written in Go.',
    credentialDescription:
      'A valid credential for your StremThru instance, defined in the `STREMTHRU_PROXY_AUTH` environment variable.',
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
  [ALLEDEBRID_SERVICE]: {
    id: ALLEDEBRID_SERVICE,
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
        id: 'apiKey',
        name: 'Encoded Token',
        description:
          'Please authorise at MediaFusion and copy the token into here.',
        type: 'password',
        required: true,
      },
    ],
  },
};

export const DEDUPLICATOR_KEYS = [
  'filename',
  'infoHash',
  'smartDetect',
] as const;

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

const VISUAL_TAGS = [
  'HDR+DV',
  'HDR10+',
  'HDR10',
  'DV',
  'HDR',
  '10bit',
  '3D',
  'IMAX',
  'AI',
  'SDR',
  'Unknown',
] as const;

const AUDIO_TAGS = [
  'Atmos',
  'DD+',
  'DD',
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

const ENCODES = [
  'AV1',
  'HEVC',
  'AVC',
  'XviD',
  'DivX',
  'H-OU',
  'H-SBS',
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
  'addon',
  'regexPatterns',
  'cached',
  'library',
  'keyword',
  'streamExpressionMatched',
] as const;

export const MIN_SIZE = 0;
export const MAX_SIZE = 100 * 1000 * 1000 * 1000; // 100GB

export const MIN_SEEDERS = 0;
export const MAX_SEEDERS = 1000;

export const DEFAULT_POSTERS = [
  'aHR0cHM6Ly93d3cucG5nbWFydC5jb20vZmlsZXMvMTEvUmlja3JvbGxpbmctUE5HLVBpYy5wbmc=',
];

export const DEFAULT_YT_ID = 'eHZGWmpvNVBnRzA=';

export const SORT_CRITERIA_DETAILS = {
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
} as const;

const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export const P2P_STREAM_TYPE = 'p2p' as const;
export const LIVE_STREAM_TYPE = 'live' as const;
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

const RESOURCES = [
  STREAM_RESOURCE,
  SUBTITLES_RESOURCE,
  CATALOG_RESOURCE,
  META_RESOURCE,
  ADDON_CATALOG_RESOURCE,
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
  ALLEDEBRID_SERVICE,
  DEBRIDLINK_SERVICE,
  TORBOX_SERVICE,
  EASYDEBRID_SERVICE,
  PUTIO_SERVICE,
  PIKPAK_SERVICE,
  OFFCLOUD_SERVICE,
  SEEDR_SERVICE,
  EASYNEWS_SERVICE,
  SERVICE_DETAILS,
  HEADERS_FOR_IP_FORWARDING,
};
