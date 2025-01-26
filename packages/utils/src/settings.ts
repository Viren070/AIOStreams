import dotenv from 'dotenv';
import path from 'path';

try {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
} catch (error) {
  console.error('Error loading .env file:', error);
}

export class Settings {
  public static readonly ADDON_NAME = process.env.ADDON_NAME ?? 'Scrapie';
  public static readonly ADDON_ID =
    process.env.ADDON_ID ?? 'scrapie.vedansh.com';
  public static readonly PORT = process.env.PORT ?? 3000;
  public static readonly BRANDING =
    process.env.BRANDING ?? process.env.NEXT_PUBLIC_ELFHOSTED_BRANDING;
  public static readonly SECRET_KEY = process.env.SECRET_KEY ?? '';
  public static readonly CUSTOM_CONFIGS = process.env.CUSTOM_CONFIGS || '';
  public static readonly DISABLE_CUSTOM_CONFIG_GENERATOR_ROUTE =
    process.env.DISABLE_CUSTOM_CONFIG_GENERATOR_ROUTE === 'true';
  public static readonly COMET_URL =
    process.env.COMET_URL ?? 'https://comet.elfhosted.com/';
  public static readonly MEDIAFUSION_URL =
    process.env.MEDIAFUSION_URL ?? 'https://mediafusion.elfhosted.com/';
  public static readonly MEDIAFUSION_API_PASSWORD =
    process.env.MEDIAFUSION_API_PASSWORD ?? '';
  public static readonly JACKETTIO_URL =
    process.env.JACKETTIO_URL ?? 'https://jackettio.elfhosted.com/';
  public static readonly TORRENTIO_URL =
    process.env.TORRENTIO_URL ?? 'https://torrentio.strem.fun/';
  public static readonly ORION_STREMIO_ADDON_URL =
    process.env.ORION_STREMIO_ADDON_URL ??
    'https://5a0d1888fa64-orion.baby-beamup.club/';
  public static readonly PEERFLIX_URL =
    process.env.PEERFLIX_URL ?? 'https://peerflix-addon.onrender.com/';
  public static readonly TORBOX_STREMIO_URL =
    process.env.TORBOX_STREMIO_URL ?? 'https://stremio.torbox.app/';
  public static readonly EASYNEWS_URL =
    process.env.EASYNEWS_URL ??
    'https://ea627ddf0ee7-easynews.baby-beamup.club/';
  public static readonly EASYNEWS_PLUS_URL =
    process.env.EASYNEWS_PLUS_URL ??
    'https://b89262c192b0-stremio-easynews-addon.baby-beamup.club/';
  public static readonly DEBRIDIO_URL =
    process.env.DEBRIDIO_URL ?? 'https://debridio.adobotec.com/';
  public static readonly ADDON_PROXY = process.env.ADDON_PROXY ?? '';
  public static readonly DEFAULT_MEDIAFLOW_URL =
    process.env.DEFAULT_MEDIAFLOW_URL ?? '';
  public static readonly DEFAULT_MEDIAFLOW_API_PASSWORD =
    process.env.DEFAULT_MEDIAFLOW_API_PASSWORD ?? '';
  public static readonly DEFAULT_MEDIAFLOW_PUBLIC_IP =
    process.env.DEFAULT_MEDIAFLOW_PUBLIC_IP ?? '';
  public static readonly MAX_ADDONS = process.env.MAX_ADDONS
    ? parseInt(process.env.MAX_ADDONS)
    : 15;
  public static readonly MAX_KEYWORD_FILTERS = process.env.MAX_KEYWORD_FILTERS
    ? parseInt(process.env.MAX_KEYWORD_FILTERS)
    : 30;
  public static readonly MAX_MOVIE_SIZE = process.env.MAX_MOVIE_SIZE
    ? parseInt(process.env.MAX_MOVIE_SIZE)
    : 161061273600; // 150GiB
  public static readonly MAX_EPISODE_SIZE = process.env.MAX_EPISODE_SIZE
    ? parseInt(process.env.MAX_EPISODE_SIZE)
    : 16106127360; // 15GiB
  public static readonly MAX_TIMEOUT = process.env.MAX_TIMEOUT
    ? parseInt(process.env.MAX_TIMEOUT)
    : 50000;
  public static readonly MIN_TIMEOUT = process.env.MIN_TIMEOUT
    ? parseInt(process.env.MIN_TIMEOUT)
    : 1000;
  public static readonly MEDIAFLOW_IP_TIMEOUT = process.env.MEDIAFLOW_IP_TIMEOUT
    ? parseInt(process.env.MEDIAFLOW_IP_TIMEOUT)
    : 30000;
  public static readonly DEFAULT_TIMEOUT = process.env.DEFAULT_TIMEOUT
    ? parseInt(process.env.DEFAULT_TIMEOUT)
    : 15000;
  public static readonly DEFAULT_TORRENTIO_TIMEOUT = process.env
    .DEFAULT_TORRENTIO_TIMEOUT
    ? parseInt(process.env.DEFAULT_TORRENTIO_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_TORBOX_TIMEOUT = process.env
    .DEFAULT_TORBOX_TIMEOUT
    ? parseInt(process.env.DEFAULT_TORBOX_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_COMET_TIMEOUT = process.env
    .DEFAULT_COMET_TIMEOUT
    ? parseInt(process.env.DEFAULT_COMET_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_MEDIAFUSION_TIMEOUT = process.env
    .DEFAULT_MEDIAFUSION_TIMEOUT
    ? parseInt(process.env.DEFAULT_MEDIAFUSION_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_JACKETTIO_TIMEOUT = process.env
    .DEFAULT_JACKETTIO_TIMEOUT
    ? parseInt(process.env.DEFAULT_JACKETTIO_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_ORION_TIMEOUT = process.env
    .DEFAULT_ORION_TIMEOUT
    ? parseInt(process.env.DEFAULT_ORION_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_PEERFLIX_TIMEOUT = process.env
    .DEFAULT_PEERFLIX_TIMEOUT
    ? parseInt(process.env.DEFAULT_PEERFLIX_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_EASYNEWS_TIMEMOUT = process.env
    .DEFAULT_EASYNEWS_TIMEMOUT
    ? parseInt(process.env.DEFAULT_EASYNEWS_TIMEMOUT)
    : undefined;
  public static readonly DEFAULT_EASYNEWS_PLUS_TIMEMOUT = process.env
    .DEFAULT_EASYNEWS_PLUS_TIMEMOUT
    ? parseInt(process.env.DEFAULT_EASYNEWS_PLUS_TIMEMOUT)
    : undefined;
  public static readonly DEFAULT_DEBRIDIO_TIMEOUT = process.env
    .DEFAULT_DEBRIDIO_TIMEOUT
    ? parseInt(process.env.DEFAULT_DEBRIDIO_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_DMM_CAST_TIMEOUT = process.env
    .DEFAULT_DMM_CAST_TIMEOUT
    ? parseInt(process.env.DEFAULT_DMM_CAST_TIMEOUT)
    : undefined;
  public static readonly DEFAULT_GDRIVE_TIMEOUT = process.env
    .DEFAULT_GDRIVE_TIMEOUT
    ? parseInt(process.env.DEFAULT_GDRIVE_TIMEOUT)
    : undefined;
  public static readonly SHOW_DIE = process.env.SHOW_DIE
    ? process.env.SHOW_DIE === 'true'
    : false;
  public static readonly LOG_SENSITIVE_INFO = process.env.LOG_SENSITIVE_INFO
    ? process.env.LOG_SENSITIVE_INFO === 'true'
    : false;
  public static readonly DISABLE_TORRENTIO = process.env.DISABLE_TORRENTIO
    ? process.env.DISABLE_TORRENTIO === 'true'
    : false;
  public static readonly DISABLE_TORRENTIO_MESSAGE =
    process.env.DISABLE_TORRENTIO_MESSAGE ||
    'The Torrentio addon has been disabled, please remove it to use this addon.';
}
