import { AIOStreamsAPI, parseManifestUrl } from "../../lib/aiostreams";
import {
  applyPreferredMapping,
  createParsedIdFromSmartSearch,
  formatIdForSearch,
  PreferredSearchId,
} from "../../lib/provider/anime-id";
import {
  toAnimeTorrent,
  ResultFormat,
} from "../../lib/provider/torrent-mapper";

class Provider {
  // aiostreamsBaseUrl = "{{baseUrl}}";
  // aiostreamsUuid = "{{uuid}}";
  // aiostreamsPassword = "{{password}}";
  aiostreamsManifestUrl = "{{manifestUrl}}";

  searchId = "{{searchId}}";
  resultFormat = "{{resultFormat}}";

  getSettings(): AnimeProviderSettings {
    return {
      canSmartSearch: true,
      smartSearchFilters: ["episodeNumber"],
      supportsAdult: true,
      type: "special",
    };
  }

  async search(_opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
    return [];
  }

  async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
    const id = createParsedIdFromSmartSearch(opts);
    if (!id) {
      console.warn("No valid media ID for smart search", opts);
      return [];
    }

    const { baseUrl, uuid, encryptedPassword } = parseManifestUrl(
      this.aiostreamsManifestUrl,
    );

    const aiostreams = new AIOStreamsAPI(baseUrl, uuid, encryptedPassword);

    const type = opts.media.format === "TV" ? "series" : "movie";
    const animeEntry = await aiostreams.anime(id.type, id.value);

    if (animeEntry) {
      applyPreferredMapping(
        id,
        animeEntry,
        $getUserPreference("searchId") as PreferredSearchId,
      );
    }

    const response = await aiostreams.search(
      type,
      formatIdForSearch(id),
      id.season,
      id.episode,
    );

    return response.results
      .map((item) =>
        toAnimeTorrent(
          item,
          $getUserPreference("resultFormat") as ResultFormat,
        ),
      )
      .filter((torrent) => torrent.infoHash);
  }

  async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
    return torrent.infoHash || "";
  }

  async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
    return torrent.magnetLink || "";
  }

  async getLatest(): Promise<AnimeTorrent[]> {
    return [];
  }
}

(globalThis as { Provider?: typeof Provider }).Provider = Provider;
