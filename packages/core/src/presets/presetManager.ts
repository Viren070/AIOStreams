import { PresetMetadata, PresetMinimalMetadata } from '../db/index.js';
import { CometPreset } from './comet.js';
import { CustomPreset } from './custom.js';
import { MediaFusionPreset } from './mediafusion.js';
import { StremthruStorePreset } from './stremthruStore.js';
import { TorrentioPreset } from './torrentio.js';
import { TorboxAddonPreset } from './torbox.js';
import { EasynewsPreset } from './easynews.js';
import { EasynewsPlusPreset } from './easynewsPlus.js';
import { EasynewsPlusPlusPreset } from './easynewsPlusPlus.js';
import { StremthruTorzPreset } from './stremthruTorz.js';
import { DebridioPreset } from './debridioScraper.js';
import { AIOStreamsPreset } from './aiostreams.js';
import { OpenSubtitlesPreset } from './opensubtitles.js';
import { PeerflixPreset } from './peerflix.js';
import { DMMCastPreset } from './dmmCast.js';
import { MarvelPreset } from './marvel.js';
import { JackettioPreset } from './jackettio.js';
import { OrionPreset } from './orion.js';
import { StreamFusionPreset } from './streamfusion.js';
import { AnimeKitsuPreset } from './animeKitsu.js';
import { NuvioStreamsPreset } from './nuviostreams.js';
import { RpdbCatalogsPreset } from './rpdbCatalogs.js';
import { TmdbCollectionsPreset } from './tmdbCollections.js';
import { DebridioWatchtowerPreset } from './debridioWatchtower.js';
import { DebridioTmdbPreset } from './debridioTmdb.js';
import { StarWarsUniversePreset } from './starWarsUniverse.js';
import { DebridioTvdbPreset } from './debridioTvdb.js';
import { DcUniversePreset } from './dcUniverse.js';
import { DebridioTvPreset } from './debridioTv.js';
import { TorrentCatalogsPreset } from './torrentCatalogs.js';
import { StreamingCatalogsPreset } from './streamingCatalogs.js';
import { AnimeCatalogsPreset } from './animeCatalogs.js';
import { DoctorWhoUniversePreset } from './doctorWhoUniverse.js';
import { WebStreamrPreset } from './webstreamr.js';
import { TMDBAddonPreset } from './tmdb.js';
import { TorrentsDbPreset } from './torrentsDb.js';
import { USATVPreset } from './usaTv.js';
import { ArgentinaTVPreset } from './argentinaTv.js';
import { OpenSubtitlesV3PlusPreset } from './opensubtitles-v3-plus.js';
import { SubSourcePreset } from './subsource.js';
import { SubDLPreset } from './subdl.js';
import { AISearchPreset } from './aiSearch.js';
import { FKStreamPreset } from './fkstream.js';
import { AIOSubtitlePreset } from './aiosubtitle.js';
import { SubHeroPreset } from './subhero.js';
import { StreamAsiaPreset } from './streamasia.js';
import { MoreLikeThisPreset } from './moreLikeThis.js';
import { GDriveAPI } from '../builtins/gdrive/index.js';
import { GDrivePreset } from './gdrive.js';
import { ContentDeepDivePreset } from './contentDeepDive.js';
import { AICompanionPreset } from './aiCompanion.js';
import { GoogleOAuth } from '../builtins/gdrive/api.js';
import { TorBoxSearchPreset } from './torboxSearch.js';
import { TorznabPreset } from './torznab.js';
import { AStreamPreset } from './aStream.js';
import { Env } from '../utils/env.js';
import { ZileanPreset } from './zilean.js';
import { AnimeToshoPreset } from './animetosho.js';
import { NewznabPreset } from './newznab.js';
import { ProwlarrPreset } from './prowlarr.js';
import { JackettPreset } from './jackett.js';
import { NZBHydraPreset } from './nzbhydra.js';

let PRESET_LIST: string[] = [
  'custom',
  'torznab',
  'newznab',
  'aiostreams',
  'torrentio',
  'comet',
  'mediafusion',
  'stremthruTorz',
  'stremthruStore',
  'animetosho',
  'zilean',
  'prowlarr',
  'jackett',
  'nzbhydra',
  'jackettio',
  'peerflix',
  'orion',
  'torrents-db',
  'streamfusion',
  'fkstream',
  'debridio',
  'torbox',
  'torbox-search',
  'easynews',
  'easynewsPlus',
  'easynewsPlusPlus',
  'dmm-cast',
  'nuvio-streams',
  'webstreamr',
  'astream',
  'streamasia',
  Env.BUILTIN_GDRIVE_CLIENT_ID && Env.BUILTIN_GDRIVE_CLIENT_SECRET
    ? 'stremio-gdrive'
    : '',
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
  'subhero',
  'aiosubtitle',
  'ai-companion',
  'ai-search',
  'more-like-this',
  'content-deep-dive',
].filter(Boolean);

export class PresetManager {
  static getPresetList(): PresetMinimalMetadata[] {
    return PRESET_LIST.map((presetId) => this.fromId(presetId).METADATA).map(
      (metadata: PresetMetadata) => ({
        ID: metadata.ID,
        NAME: metadata.NAME,
        LOGO: metadata.LOGO,
        DESCRIPTION: metadata.DESCRIPTION,
        URL: metadata.URL,
        SUPPORTED_RESOURCES: metadata.SUPPORTED_RESOURCES,
        SUPPORTED_STREAM_TYPES: metadata.SUPPORTED_STREAM_TYPES,
        SUPPORTED_SERVICES: metadata.SUPPORTED_SERVICES,
        OPTIONS: metadata.OPTIONS,
        BUILTIN: metadata.BUILTIN,
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
      case 'fkstream':
        return FKStreamPreset;
      case 'anime-kitsu':
        return AnimeKitsuPreset;
      case 'nuvio-streams':
        return NuvioStreamsPreset;
      case 'webstreamr':
        return WebStreamrPreset;
      case 'astream':
        return AStreamPreset;
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
      case 'ai-search':
        return AISearchPreset;
      case 'aiosubtitle':
        return AIOSubtitlePreset;
      case 'subhero':
        return SubHeroPreset;
      case 'streamasia':
        return StreamAsiaPreset;
      case 'more-like-this':
        return MoreLikeThisPreset;
      case 'content-deep-dive':
        return ContentDeepDivePreset;
      case 'ai-companion':
        return AICompanionPreset;
      case 'stremio-gdrive':
        return GDrivePreset;
      case 'torbox-search':
        return TorBoxSearchPreset;
      case 'torznab':
        return TorznabPreset;
      case 'newznab':
        return NewznabPreset;
      case 'zilean':
        return ZileanPreset;
      case 'animetosho':
        return AnimeToshoPreset;
      case 'prowlarr':
        return ProwlarrPreset;
      case 'jackett':
        return JackettPreset;
      case 'nzbhydra':
        return NZBHydraPreset;
      default:
        throw new Error(`Preset ${id} not found`);
    }
  }
}
