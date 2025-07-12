import { PresetMetadata, PresetMinimalMetadata } from '../db';
import { CometPreset } from './comet';
import { CustomPreset } from './custom';
import { MediaFusionPreset } from './mediafusion';
import { StremthruStorePreset } from './stremthruStore';
import { TorrentioPreset } from './torrentio';
import { TorboxAddonPreset } from './torbox';
import { EasynewsPreset } from './easynews';
import { EasynewsPlusPreset } from './easynewsPlus';
import { EasynewsPlusPlusPreset } from './easynewsPlusPlus';
import { StremthruTorzPreset } from './stremthruTorz';
import { DebridioPreset } from './debridio';
import { AIOStreamsPreset } from './aiostreams';
import { OpenSubtitlesPreset } from './opensubtitles';
import { PeerflixPreset } from './peerflix';
import { DMMCastPreset } from './dmmCast';
import { MarvelPreset } from './marvel';
import { JackettioPreset } from './jackettio';
import { OrionPreset } from './orion';
import { StreamFusionPreset } from './streamfusion';
import { AnimeKitsuPreset } from './animeKitsu';
import { NuvioStreamsPreset } from './nuviostreams';
import { RpdbCatalogsPreset } from './rpdbCatalogs';
import { TmdbCollectionsPreset } from './tmdbCollections';
import { DebridioWatchtowerPreset } from './debridioWatchtower';
import { DebridioTmdbPreset } from './debridioTmdb';
import { StarWarsUniversePreset } from './starWarsUniverse';
import { DebridioTvdbPreset } from './debridioTvdb';
import { DcUniversePreset } from './dcUniverse';
import { DebridioTvPreset } from './debridioTv';
import { TorrentCatalogsPreset } from './torrentCatalogs';
import { StreamingCatalogsPreset } from './streamingCatalogs';
import { AnimeCatalogsPreset } from './animeCatalogs';
import { DoctorWhoUniversePreset } from './doctorWhoUniverse';
import { WebStreamrPreset } from './webstreamr';
import { TMDBAddonPreset } from './tmdb';
import { TorrentsDbPreset } from './torrentsDb';
import { USATVPreset } from './usaTv';
import { ArgentinaTVPreset } from './argentinaTv';
import { OpenSubtitlesV3PlusPreset } from './opensubtitles-v3-plus';
import { SubSourcePreset } from './subsource';
import { SubDLPreset } from './subdl';

const PRESET_LIST: string[] = [
  'custom',
  'torrentio',
  'comet',
  'mediafusion',
  'stremthruTorz',
  'stremthruStore',
  'jackettio',
  'peerflix',
  'orion',
  'torrents-db',
  'streamfusion',
  'debridio',
  'torbox',
  'easynews',
  'easynewsPlus',
  'easynewsPlusPlus',
  'dmm-cast',
  'nuvio-streams',
  'webstreamr',
  'usa-tv',
  'argentina-tv',
  'debridio-tv',
  'debridio-watchtower',
  'tmdb-addon',
  'debridio-tmdb',
  'debridio-tvdb',
  'streaming-catalogs',
  'anime-catalogs',
  'torrent-catalogs',
  'rpdb-catalogs',
  'tmdb-collections',
  'anime-kitsu',
  'marvel-universe',
  'star-wars-universe',
  'dc-universe',
  'doctor-who-universe',
  'opensubtitles',
  'opensubtitles-v3-plus',
  'subsource',
  'subdl',
  'aiostreams',
];

export class PresetManager {
  static getPresetList(): PresetMinimalMetadata[] {
    return PRESET_LIST.map((presetId) => this.fromId(presetId).METADATA).map(
      (metadata) => ({
        ID: metadata.ID,
        NAME: metadata.NAME,
        LOGO: metadata.LOGO,
        DESCRIPTION: metadata.DESCRIPTION,
        URL: metadata.URL,
        SUPPORTED_RESOURCES: metadata.SUPPORTED_RESOURCES,
        SUPPORTED_STREAM_TYPES: metadata.SUPPORTED_STREAM_TYPES,
        SUPPORTED_SERVICES: metadata.SUPPORTED_SERVICES,
        OPTIONS: metadata.OPTIONS,
      })
    );
  }

  static fromId(id: string) {
    switch (id) {
      case 'torrentio':
        return TorrentioPreset;
      case 'stremthruStore':
        return StremthruStorePreset;
      case 'stremthruTorz':
        return StremthruTorzPreset;
      case 'comet':
        return CometPreset;
      case 'mediafusion':
        return MediaFusionPreset;
      case 'custom':
        return CustomPreset;
      case 'torbox':
        return TorboxAddonPreset;
      case 'jackettio':
        return JackettioPreset;
      case 'easynews':
        return EasynewsPreset;
      case 'easynewsPlus':
        return EasynewsPlusPreset;
      case 'easynewsPlusPlus':
        return EasynewsPlusPlusPreset;
      case 'debridio':
        return DebridioPreset;
      case 'debridio-watchtower':
        return DebridioWatchtowerPreset;
      case 'debridio-tv':
        return DebridioTvPreset;
      case 'debridio-tmdb':
        return DebridioTmdbPreset;
      case 'debridio-tvdb':
        return DebridioTvdbPreset;
      case 'aiostreams':
        return AIOStreamsPreset;
      case 'opensubtitles':
        return OpenSubtitlesPreset;
      case 'peerflix':
        return PeerflixPreset;
      case 'dmm-cast':
        return DMMCastPreset;
      case 'marvel-universe':
        return MarvelPreset;
      case 'orion':
        return OrionPreset;
      case 'streamfusion':
        return StreamFusionPreset;
      case 'anime-kitsu':
        return AnimeKitsuPreset;
      case 'nuvio-streams':
        return NuvioStreamsPreset;
      case 'webstreamr':
        return WebStreamrPreset;
      case 'streaming-catalogs':
        return StreamingCatalogsPreset;
      case 'anime-catalogs':
        return AnimeCatalogsPreset;
      case 'torrent-catalogs':
        return TorrentCatalogsPreset;
      case 'rpdb-catalogs':
        return RpdbCatalogsPreset;
      case 'tmdb-collections':
        return TmdbCollectionsPreset;
      case 'star-wars-universe':
        return StarWarsUniversePreset;
      case 'dc-universe':
        return DcUniversePreset;
      case 'doctor-who-universe':
        return DoctorWhoUniversePreset;
      case 'tmdb-addon':
        return TMDBAddonPreset;
      case 'torrents-db':
        return TorrentsDbPreset;
      case 'usa-tv':
        return USATVPreset;
      case 'argentina-tv':
        return ArgentinaTVPreset;
      case 'opensubtitles-v3-plus':
        return OpenSubtitlesV3PlusPreset;
      case 'subsource':
        return SubSourcePreset;
      case 'subdl':
        return SubDLPreset;
      default:
        throw new Error(`Preset ${id} not found`);
    }
  }
}
