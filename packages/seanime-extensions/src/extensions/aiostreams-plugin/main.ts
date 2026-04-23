import {
  AIOStreamsSearchApiResult,
  AIOStreamsAnimeEntry,
  ParsedId,
} from '../../lib/aiostreams';

function init() {
  $ui.register((ctx) => {
    const SK_CACHE_STORE = 'aio_cache';

    interface StreamResult {
      infoHash: string | null;
      url: string | null;
      externalUrl: string | null;
      seeders: number | null;
      size: number | null;
      name: string | null;
      description: string | null;
      service: string | null;
      filename: string | null;
      folderName: string | null;
      cached: boolean | null;
      resolution: string | null;
      releaseGroup: string | null;
      addon: string | null;
      indexer: string | null;
      type: string;
      seadexBest: boolean | null;
      magnetLink: string | null;
      fileIdx: number | null;
    }

    interface StatEntry {
      title: string;
      description: string;
    }

    interface LookupInfo {
      original: string;
      resolved: string;
      stremioId: string;
    }

    interface WebviewState {
      results: StreamResult[];
      loading: boolean;
      error: string | null;
      episodeInfo: string;
      timeTakenMs: number | null;
      animeLookupMs: number | null;
      searchMs: number | null;
      fromCache: boolean;
      errors: StatEntry[];
      statistics: StatEntry[];
      lookup: LookupInfo | null;
      sessionId: string;
      autoPlay: boolean;
    }

    interface ParsedManifestCredentials {
      baseUrl: string;
      uuid: string;
      passwordToken: string;
    }

    function buildMagnetLink(result: AIOStreamsSearchApiResult): string | null {
      if (!result.infoHash) return null;

      let magnet = `magnet:?xt=urn:btih:${result.infoHash}`;
      const torrentName = result.folderName ?? result.filename;
      if (torrentName) magnet += `&dn=${encodeURIComponent(torrentName)}`;
      if (result.sources) {
        result.sources
          .filter((src) => !src.startsWith('dht:'))
          .forEach((src) => {
            magnet += `&tr=${encodeURIComponent(src.startsWith('tracker:') ? src.slice('tracker:'.length) : src)}`;
          });
      }
      return magnet;
    }

    function toStreamResult(r: AIOStreamsSearchApiResult): StreamResult {
      return {
        infoHash: r.infoHash ?? null,
        url: r.url ?? null,
        externalUrl: r.externalUrl ?? null,
        seeders: r.seeders ?? null,
        size: r.size ?? null,
        name: r.name ?? null,
        description: r.description ?? null,
        service: r.service ?? null,
        cached: r.cached ?? null,
        filename: r.filename ?? null,
        folderName: r.folderName ?? null,
        resolution: r.parsedFile?.resolution ?? null,
        releaseGroup: r.parsedFile?.releaseGroup ?? null,
        addon: r.addon ?? null,
        indexer: r.indexer ?? null,
        type: r.type,
        seadexBest: r.seadexBest ?? null,
        magnetLink: buildMagnetLink(r),
        fileIdx: r.fileIdx ?? null,
      };
    }

    function getSeasonFromSynonyms(synonyms: string[]): number | undefined {
      const seasonRegex = /(?:season|s)\s(\d+)/i;
      for (const synonym of synonyms) {
        const match = synonym.match(seasonRegex);
        if (match) return Number(match[1].trim());
      }
      return undefined;
    }

    function enrichParsedIdWithAnimeEntry(
      parsedId: ParsedId,
      animeEntry: AIOStreamsAnimeEntry
    ): void {
      let episodeOffsetApplied = false;
      const imdbId = animeEntry?.mappings?.imdbId;
      if (
        parsedId.episode &&
        animeEntry?.episodeMappings &&
        animeEntry.episodeMappings.length > 0
      ) {
        const episodeNum = Number(parsedId.episode);
        const mapping = animeEntry.episodeMappings.find(
          (m) =>
            m.start !== undefined &&
            m.end !== undefined &&
            episodeNum >= m.start &&
            episodeNum <= m.end
        );
        if (mapping) {
          const mappedSeason = mapping.tvdbSeason;
          const shouldApplyEpisodeOffset =
            imdbId && ['tt1528406'].includes(imdbId);
          if (
            mappedSeason &&
            shouldApplyEpisodeOffset &&
            mapping.offset !== undefined
          ) {
            parsedId.season = mappedSeason;
            parsedId.episode = episodeNum + mapping.offset;
            episodeOffsetApplied = true;
          }
        }
      }
      if (!parsedId.season) {
        parsedId.season =
          animeEntry.imdb?.seasonNumber ??
          animeEntry.trakt?.seasonNumber ??
          animeEntry.tvdb?.seasonNumber ??
          getSeasonFromSynonyms(animeEntry.synonyms ?? []) ??
          animeEntry.tmdb?.seasonNumber ??
          undefined;
      }
      if (
        parsedId.episode &&
        ['malId', 'kitsuId', 'anilistId', 'anidbId'].includes(parsedId.type) &&
        !episodeOffsetApplied
      ) {
        const fromEpisode =
          animeEntry.imdb?.fromEpisode ?? animeEntry.tvdb?.fromEpisode;
        if (fromEpisode && fromEpisode !== 1) {
          parsedId.episode = fromEpisode + Number(parsedId.episode) - 1;
        }
      }
    }

    function applyPreferredMapping(
      parsedId: ParsedId,
      animeEntry: AIOStreamsAnimeEntry,
      preferred: 'imdbId' | 'kitsuId' | 'anilistId'
    ): ParsedId {
      if (preferred === 'kitsuId' && animeEntry.mappings?.kitsuId) {
        parsedId.type = 'kitsuId';
        parsedId.value = String(animeEntry.mappings.kitsuId);
        return parsedId;
      }
      if (preferred === 'anilistId' && animeEntry.mappings?.anilistId) {
        parsedId.type = 'anilistId';
        parsedId.value = String(animeEntry.mappings.anilistId);
        return parsedId;
      }
      if (animeEntry.mappings?.imdbId) {
        enrichParsedIdWithAnimeEntry(parsedId, animeEntry);
        parsedId.type = 'imdbId';
        parsedId.value = String(animeEntry.mappings.imdbId);
      }
      return parsedId;
    }

    function formatIdForSearch(id: ParsedId): string {
      switch (id.type) {
        case 'anidbId':
          return `anidb:${id.value}`;
        case 'anilistId':
          return `anilist:${id.value}`;
        case 'malId':
          return `mal:${id.value}`;
        case 'kitsuId':
          return `kitsu:${id.value}`;
        case 'imdbId':
          return String(id.value);
        case 'stremioId':
          return String(id.value);
        default:
          return `${id.type}:${id.value}`;
      }
    }

    function parseStremioId(stremioId: string): {
      season?: number;
      episode?: number;
      baseId: string;
    } {
      // Schemes where base ID is scheme:number (e.g. kitsu:12312)
      const prefixedSchemes = [
        'kitsu:',
        'mal:',
        'anilist:',
        'tmdb:',
        'tvdb:',
        'anidb:',
        'simkl:',
      ];

      const colonIdx = stremioId.indexOf(':');
      if (colonIdx === -1) return { baseId: stremioId };

      // IMDb: tt1234567[:season[:episode]]
      if (/^tt\d+/.test(stremioId)) {
        const baseId = stremioId.slice(0, colonIdx);
        const rest = stremioId
          .slice(colonIdx + 1)
          .split(':')
          .map(Number);
        if (rest.length === 1 && Number.isFinite(rest[0]))
          return { baseId, episode: rest[0] };
        if (
          rest.length >= 2 &&
          Number.isFinite(rest[0]) &&
          Number.isFinite(rest[1])
        )
          return { baseId, season: rest[0], episode: rest[1] };
        return { baseId };
      }

      // Prefixed numeric schemes: scheme:baseNum[:episode] or scheme:baseNum[:season:episode]
      const scheme = prefixedSchemes.find((s) => stremioId.startsWith(s));
      if (scheme) {
        const afterScheme = stremioId.slice(scheme.length);
        const parts = afterScheme.split(':');
        const baseId = `${scheme}${parts[0]}`;
        const rest = parts.slice(1).map(Number);
        if (rest.length === 0) return { baseId };
        if (rest.length === 1 && Number.isFinite(rest[0]))
          return { baseId, episode: rest[0] };
        if (
          rest.length >= 2 &&
          Number.isFinite(rest[0]) &&
          Number.isFinite(rest[1])
        )
          return { baseId, season: rest[0], episode: rest[1] };
        return { baseId };
      }

      // Unknown scheme: strip trailing numeric segments
      const parts = stremioId.split(':');
      const nums: number[] = [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const n = Number(parts[i]);
        if (!Number.isFinite(n)) break;
        nums.unshift(n);
      }
      if (nums.length === 0) return { baseId: stremioId };
      if (nums.length === 1)
        return { episode: nums[0], baseId: parts.slice(0, -1).join(':') };
      return {
        season: nums[nums.length - 2],
        episode: nums[nums.length - 1],
        baseId: parts.slice(0, -2).join(':'),
      };
    }
    function parseManifestUrl(manifestUrl: string): ParsedManifestCredentials {
      const clean = manifestUrl.trim();
      if (!clean) throw new Error('Manifest URL is required');

      const parsed = new URL(clean);
      const segments = parsed.pathname.split('/').filter(Boolean);

      if (
        segments.length < 4 ||
        segments[0] !== 'stremio' ||
        segments[segments.length - 1] !== 'manifest.json'
      ) {
        throw new Error('Invalid manifest URL format');
      }

      const uuid = decodeURIComponent(segments[1]);
      const passwordToken = decodeURIComponent(segments[2]);
      const baseUrl = `${parsed.protocol}//${parsed.host}`;

      if (!uuid || !passwordToken)
        throw new Error('Manifest URL is missing uuid or password token');

      return { baseUrl, uuid, passwordToken };
    }

    function getCacheTtlMinutes(): number {
      const v = $getUserPreference('cacheTtl');
      if (!v) return 30;
      const n = parseInt(v, 10);
      return isNaN(n) || n < 0 ? 30 : n;
    }

    async function aioSearch(
      baseUrl: string,
      uuid: string,
      passwordToken: string,
      type: string,
      id: string,
      season?: number,
      episode?: number
    ): Promise<{
      errors: StatEntry[];
      results: AIOStreamsSearchApiResult[];
      statistics?: StatEntry[];
    }> {
      const fullId = `${id}${season !== undefined ? `:${season}` : ''}${episode !== undefined ? `:${episode}` : ''}`;
      const params = new URLSearchParams({ type, id: fullId, format: 'true' });
      const url = `${baseUrl}/api/v1/search?${params}`;
      const encodedAuth = CryptoJS.enc.Base64.stringify(
        CryptoJS.enc.Utf8.parse(`${uuid}:${passwordToken}`)
      );
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Basic ${encodedAuth}` },
        credentials: 'include',
      });
      const json = await response.json();
      if (!json.success)
        throw new Error(json.error?.message ?? 'Unknown error');
      return json.data;
    }

    async function aioAnime(
      baseUrl: string,
      uuid: string,
      passwordToken: string,
      idType: string,
      idValue: string | number
    ): Promise<AIOStreamsAnimeEntry | null> {
      const params = new URLSearchParams({ idType, idValue: String(idValue) });
      const url = `${baseUrl}/api/v1/anime?${params}`;
      const encodedAuth = CryptoJS.enc.Base64.stringify(
        CryptoJS.enc.Utf8.parse(`${uuid}:${passwordToken}`)
      );
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Basic ${encodedAuth}` },
        credentials: 'include',
      });
      if (response.status === 204) return null;
      const json = await response.json();
      if (!json.success) return null;
      return json.data as AIOStreamsAnimeEntry;
    }

    function getCacheKey(parsedId: ParsedId): string {
      return `${parsedId.type}:${parsedId.value}:s${parsedId.season ?? 0}:e${parsedId.episode ?? 0}`;
    }

    function getCached(key: string): StreamResult[] | null {
      const ttl = getCacheTtlMinutes();
      if (ttl === 0) return null;
      const store =
        $storage.get<Record<string, { results: StreamResult[]; ts: number }>>(
          SK_CACHE_STORE
        ) ?? {};
      const entry = store[key];
      if (!entry) return null;
      if (Date.now() - entry.ts > ttl * 60 * 1000) return null;
      return entry.results;
    }

    function setCached(key: string, results: StreamResult[]): void {
      const ttl = getCacheTtlMinutes();
      if (ttl === 0) return;
      const store =
        $storage.get<Record<string, { results: StreamResult[]; ts: number }>>(
          SK_CACHE_STORE
        ) ?? {};
      store[key] = { results, ts: Date.now() };
      $storage.set(SK_CACHE_STORE, store);
    }

    function clearCache(): void {
      $storage.set(SK_CACHE_STORE, {});
    }

    function getResultsHtml(): string {
      return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AIOStreams</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;width:100%;overflow:hidden;background-color:transparent !important;color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;color:#e2e8f0;font-size:14px;-webkit-font-smoothing:antialiased}
.panel{position:absolute;inset:0;display:flex;flex-direction:column;background:#0a0a0a;border:1px solid rgba(255,255,255,0.08);border-radius:14px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6),0 0 0 1px rgba(0,0,0,0.4);overflow:hidden;animation:slideIn .32s cubic-bezier(0.16,1,0.3,1) both}
.panel.is-leaving{animation:slideOut .24s cubic-bezier(0.7,0,0.84,0) both}
.panel.mobile{border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(0,0,0,0.4);animation:slideInUp .32s cubic-bezier(0.16,1,0.3,1) both}
.panel.mobile.is-leaving{animation:slideOutDown .24s cubic-bezier(0.7,0,0.84,0) both}
@keyframes slideIn{from{transform:translateX(60px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(60px);opacity:0}}
@keyframes slideInUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes slideOutDown{from{transform:translateY(0);opacity:1}to{transform:translateY(60px);opacity:0}}
.hdr{display:flex;align-items:flex-start;gap:8px;padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0}
.hdr-body{flex:1;min-width:0}
.hdr-row{display:flex;align-items:center;gap:8px}
.hdr-title{font-size:14px;font-weight:700;letter-spacing:.01em;color:#e2e8f0}

.hdr-sub{font-size:12px;color:rgba(255,255,255,0.38);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xbtn{background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;padding:5px;border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .12s,color .12s;margin-top:-2px}
.xbtn:hover{background:rgba(255,255,255,0.07);color:#e2e8f0}
.body{flex:1;overflow-y:auto;padding:10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent}
.center{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;min-height:220px;color:rgba(255,255,255,0.32);font-size:13px}
.spin{width:20px;height:20px;border:2px solid rgba(255,255,255,0.07);border-top-color:rgb(97,82,223);border-radius:50%;animation:sp .65s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.err-txt{color:#f87171;text-align:center;max-width:86%;line-height:1.55;font-size:13px}
.card{border:1px solid rgba(255,255,255,0.07);border-radius:10px;background:rgba(255,255,255,0.022);margin-bottom:6px;overflow:hidden;transition:border-color .15s}
.card:hover{border-color:rgba(255,255,255,0.13)}
.card-top{padding:11px 12px 9px}
.card-name{font-size:15px;font-weight:500;line-height:1.45;color:#e2e8f0;white-space:pre-line;word-break:break-word}
.card-desc{font-size:14px;line-height:1.5;color:rgba(255,255,255,0.58);white-space:pre-line;word-break:break-word;margin-top:4px}
.card-actions{display:flex;gap:5px;padding:0 10px 10px}
.btn-p{flex:1;height:38px;border-radius:6px;border:none;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;background:rgb(97,82,223);color:#fff;position:relative;overflow:hidden;transition:opacity .12s;font-family:inherit}
.btn-p:disabled{opacity:.5;cursor:not-allowed}
.btn-p:not(:disabled):hover{opacity:.82}
.btn-p .lbl{display:inline-flex;align-items:center;gap:7px}
.btn-p.loading .lbl{opacity:0}
.btn-p.loading::after{content:'';position:absolute;width:15px;height:15px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite}
.btn-p.ext{background:rgba(8,110,146,.9)}
.btn-p.p2p{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0}
.btn-i{width:38px;height:38px;border-radius:6px;border:1px solid rgba(255,255,255,0.09);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .12s,color .12s}
.btn-i:hover{background:rgba(255,255,255,0.07);color:#e2e8f0}
.footer{display:none;align-items:center;justify-content:space-between;padding:12px 14px;border-top:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.015);flex-shrink:0}
.footer-time{font-size:12px;color:rgba(255,255,255,0.4)}
.footer-btn{display:none;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e2e8f0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.footer-btn:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.2);color:#fff}
.footer-btn.err{background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.2);color:#fca5a5}
.footer-btn.err:hover{background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.3);color:#f87171}
.overlay{position:fixed;inset:0;background:#0a0a0a;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .25s cubic-bezier(0.16,1,0.3,1)}
.overlay.open{transform:translateY(0)}
.ov-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0}
.ov-title{font-size:13px;font-weight:700}
.ov-body{flex:1;overflow-y:auto;padding:12px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent}
.ov-sec{margin-bottom:16px}
.ov-sec-label{font-size:10px;font-weight:700;color:rgba(255,255,255,0.28);letter-spacing:.09em;text-transform:uppercase;margin-bottom:8px}
.ov-item{padding:9px 11px;border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:5px;background:rgba(255,255,255,0.018)}
.ov-item-title{font-size:12px;font-weight:600;color:#e2e8f0}
.ov-item-desc{font-size:12px;color:rgba(255,255,255,0.48);margin-top:2px;line-height:1.45;white-space:pre-line;word-break:break-word}
.ov-item.is-err .ov-item-title{color:#f87171}
.dl-pct{font-size:9px;font-weight:800;line-height:1;letter-spacing:-.02em}
.btn-i.dl-ok{color:#4ade80}.btn-i.dl-err{color:#f87171}
.btn-i:disabled{opacity:.55;cursor:not-allowed}
</style>
</head>
<body>

<div class="panel" id="panel">
<div class="hdr">
  <div class="hdr-body">
    <div class="hdr-row">
      <span class="hdr-title">AIOStreams</span>
    </div>
    <div id="sub" class="hdr-sub">Fetching streams...</div>
  </div>
  <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;margin-top:-2px">
    <button class="xbtn" id="ref-btn" onclick="refresh_()" title="Refresh" style="display:none">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
    </button>
    <button class="xbtn" onclick="close_()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</div>

<div class="body">
  <div id="loading" class="center"><div class="spin"></div><span>Fetching streams...</span></div>
  <div id="results" style="display:none"></div>
  <div id="empty" class="center" style="display:none">No streams found</div>
  <div id="err" class="center" style="display:none"><span class="err-txt" id="err-msg"></span><button class="btn-p" style="flex:none;width:auto;padding:0 20px;font-size:13px;height:34px;margin-top:4px" onclick="retry_()">Try Again</button></div>
</div>

<div class="footer" id="footer">
  <span class="footer-time" id="footer-time"></span>
  <button class="footer-btn" id="footer-btn" onclick="openOverlay()"></button>
</div>

<div class="overlay" id="overlay">
  <div class="ov-hdr">
    <span class="ov-title">Details</span>
    <button class="xbtn" onclick="closeOverlay()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="ov-body" id="overlay-body"></div>
</div>

</div>

<script>
var W=window.webview,rs=[],playIdx=-1,_d={timeTakenMs:null,animeLookupMs:null,searchMs:null,fromCache:false,errors:[],statistics:[],lookup:null,sessionId:''},dlState={},_lastEpisodeInfo='';
function esc(s){if(!s&&s!==0)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmt(ms){return ms<1000?ms+'ms':(ms/1000).toFixed(1)+'s';}
function close_(){W.send('close',{});}
function retry_(){W.send('retry',{});}
function refresh_(){W.send('refresh',{});}
function updateDlBtn(i){var b=document.getElementById('dl-'+i);if(!b)return;var s=dlState[i];if(!s){b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';b.disabled=false;b.className='btn-i';b.title='Download';return;}if(s.status==='downloading'){b.innerHTML='<span class="dl-pct">'+(s.percentage<1?'\u22ef':Math.round(s.percentage)+'%')+'</span>';b.disabled=true;b.className='btn-i';b.title=s.filename?'Downloading \u2014 '+s.filename:'Downloading...';return;}if(s.status==='completed'){b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';b.disabled=false;b.className='btn-i dl-ok';b.title='Saved \u2014 '+s.filePath;return;}b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>';b.disabled=false;b.className='btn-i dl-err';b.title=(s.error||'Download failed')+' \u2014 click to retry';}
function play(i){
  if(playIdx!==-1)return;playIdx=i;
  var b=document.getElementById('pb-'+i);
  if(b){b.disabled=true;b.classList.add('loading');}
  W.send('play',{index:i});
}
function openExt(i){
  var r=rs[i];
  if(r&&r.externalUrl) window.open(r.externalUrl, '_blank');
}
function copyStream(i){var r=rs[i];if(!r)return;var t=r.url||r.magnetLink||r.externalUrl||'';if(t)W.send('copy-stream',{text:t});}
function downloadStream(i){if(dlState[i]&&dlState[i].status==='downloading')return;W.send('download',{index:i});}
W.on('play-error',function(d){
  var idx=d&&d.index!=null?d.index:playIdx;playIdx=-1;
  var b=document.getElementById('pb-'+idx);
  if(b){b.disabled=false;b.classList.remove('loading');}
});
W.on('download-progress',function(d){if(d&&d.index!=null&&d.sessionId===_d.sessionId){dlState[d.index]=d;updateDlBtn(d.index);}});
function openOverlay(){
  var html='';
  var lk=_d.lookup;
  if(lk){
    html+='<div class="ov-sec"><div class="ov-sec-label">Lookup</div>';
    if(lk.original){
      html+='<div class="ov-item"><div class="ov-item-title">Original Media</div><div class="ov-item-desc">'+esc(lk.original)+'</div></div>';
    }
    if(lk.resolved){
      html+='<div class="ov-item"><div class="ov-item-title">Resolved Media</div><div class="ov-item-desc">'+esc(lk.resolved)+'</div></div>';
    }
    if(lk.stremioId){
      html+='<div class="ov-item"><div class="ov-item-title">Stremio ID</div><div class="ov-item-desc">'+esc(lk.stremioId)+'</div></div>';
    }
    html+='</div>';
  }
  if(_d.animeLookupMs!=null||_d.searchMs!=null||_d.fromCache){
    html+='<div class="ov-sec"><div class="ov-sec-label">Timing</div>';
    if(_d.animeLookupMs!=null){
      html+='<div class="ov-item"><div class="ov-item-title">Anime Lookup</div><div class="ov-item-desc">'+fmt(_d.animeLookupMs)+'</div></div>';
    }
    var searchDesc=_d.searchMs!=null?fmt(_d.searchMs):(_d.fromCache?'Served from cache':null);
    if(searchDesc){
      html+='<div class="ov-item"><div class="ov-item-title">Stream Search</div><div class="ov-item-desc">'+esc(searchDesc)+'</div></div>';
    }
    html+='</div>';
  }
  var errs=_d.errors||[];
  if(errs.length){
    html+='<div class="ov-sec"><div class="ov-sec-label">Errors ('+errs.length+')</div>';
    errs.forEach(function(e){html+='<div class="ov-item is-err"><div class="ov-item-title">'+esc(e.title)+'</div><div class="ov-item-desc">'+esc(e.description)+'</div></div>';});
    html+='</div>';
  }
  var stats=_d.statistics||[];
  if(stats.length){
    html+='<div class="ov-sec"><div class="ov-sec-label">Statistics</div>';
    stats.forEach(function(s){html+='<div class="ov-item"><div class="ov-item-title">'+esc(s.title)+'</div><div class="ov-item-desc">'+esc(s.description)+'</div></div>';});
    html+='</div>';
  }
  if(!html)html='<div class="center" style="min-height:120px">No details available</div>';
  document.getElementById('overlay-body').innerHTML=html;
  document.getElementById('overlay').classList.add('open');
}
function closeOverlay(){document.getElementById('overlay').classList.remove('open');}
function render(s){
  var L=document.getElementById('loading'),R=document.getElementById('results'),
      E=document.getElementById('empty'),ER=document.getElementById('err'),
      SB=document.getElementById('sub'),RB=document.getElementById('ref-btn'),
      FT=document.getElementById('footer'),FTT=document.getElementById('footer-time'),
      FB=document.getElementById('footer-btn');
  _d={timeTakenMs:s.timeTakenMs,animeLookupMs:s.animeLookupMs!=null?s.animeLookupMs:null,searchMs:s.searchMs!=null?s.searchMs:null,fromCache:!!s.fromCache,errors:s.errors||[],statistics:s.statistics||[],lookup:s.lookup||null,sessionId:s.sessionId||''};
  if(s.episodeInfo)SB.textContent=s.episodeInfo;
  if(s.loading){
    L.style.display='flex';R.style.display='none';E.style.display='none';
    ER.style.display='none';FT.style.display='none';if(RB)RB.style.display='none';
    var lt=L.querySelector('span');if(lt)lt.textContent='Fetching streams\u2026';
    return;
  }
  if(s.autoPlay&&!s.error&&s.results&&s.results.length>0){
    var lt2=L.querySelector('span');if(lt2)lt2.textContent='Starting playback\u2026';
    L.style.display='flex';R.style.display='none';E.style.display='none';
    ER.style.display='none';FT.style.display='none';if(RB)RB.style.display='none';
    return;
  }
  L.style.display='none';
  closeOverlay();
  var showFooter=s.timeTakenMs!=null||(s.errors&&s.errors.length>0)||(s.statistics&&s.statistics.length>0)||!!s.lookup;
  if(showFooter){
    FT.style.display='flex';
    var rc=s.results?s.results.length:0;FTT.textContent=s.timeTakenMs!=null?(s.fromCache?'Cached':'Fetched')+' '+rc+' result'+(rc!==1?'s':'')+' in '+fmt(s.timeTakenMs):'';
    var ec=s.errors?s.errors.length:0,sc=s.statistics?s.statistics.length:0;
    var parts=[];
    if(ec>0)parts.push(ec+' error'+(ec!==1?'s':''));
    if(sc>0)parts.push(sc+' stat'+(sc!==1?'s':''));
    if(!parts.length&&s.timeTakenMs!=null)parts.push('Details');
    if(parts.length){
      FB.style.display='flex';FB.textContent=parts.join(' \u00b7 ')+' \u203a';
      FB.className='footer-btn'+(ec>0?' err':'');
    } else {
      FB.style.display='none';
    }
  } else {
    FT.style.display='none';
  }
  if(s.error){
    ER.style.display='flex';document.getElementById('err-msg').textContent=s.error;
    R.style.display='none';E.style.display='none';
    return;
  }
  ER.style.display='none';if(RB)RB.style.display='flex';
  rs=s.results||[];playIdx=-1;if(s.episodeInfo&&s.episodeInfo!==_lastEpisodeInfo){dlState={};_lastEpisodeInfo=s.episodeInfo;}
  if(rs.length===0){E.style.display='flex';R.style.display='none';return;}
  E.style.display='none';
  var COPY='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var DL='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var PLAY='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  var EXT='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  var html='';
  for(var i=0;i<rs.length;i++){
    var r=rs[i];
    var URL_TYPES=['http','usenet','debrid','live','info'];
    var acts='';
    if(URL_TYPES.indexOf(r.type)!==-1){
      acts='<button class="btn-p" id="pb-'+i+'" onclick="play('+i+')"><span class="lbl">'+PLAY+' Play</span></button>';
      acts+='<button class="btn-i" onclick="copyStream('+i+')" title="Copy URL">'+COPY+'</button>';
      acts+='<button class="btn-i" id="dl-'+i+'" onclick="downloadStream('+i+')" title="Download">'+DL+'</button>';
    }else if(r.type==='p2p'){
      acts='<button class="btn-p" id="pb-'+i+'" onclick="play('+i+')"><span class="lbl">'+PLAY+' Play</span></button>';
      if(r.magnetLink)acts+='<button class="btn-i" onclick="copyStream('+i+')" title="Copy Magnet">'+COPY+'</button>';
    }else if(r.type==='external'){
      acts='<button class="btn-p ext" onclick="openExt('+i+')"><span class="lbl">'+EXT+' Open in Browser</span></button>';
      if(r.externalUrl)acts+='<button class="btn-i" onclick="copyStream('+i+')" title="Copy URL">'+COPY+'</button>';
    }else{
      acts='<div style="color:#f87171;background:rgba(248,113,113,0.1);border:1px dashed rgba(248,113,113,0.3);border-radius:6px;padding:5px 0;font-size:12px;text-align:center;width:100%">Unsupported stream format</div>';
    }
    html+='<div class="card"><div class="card-top">';
    if(r.name)html+='<div class="card-name">'+esc(r.name)+'</div>';
    if(r.description)html+='<div class="card-desc">'+esc(r.description)+'</div>';
    html+='</div>';
    if(acts)html+='<div class="card-actions">'+acts+'</div>';
    html+='</div>';
  }
  R.innerHTML=html;R.style.display='block';
}
W.on('state',function(s){
  var p=document.getElementById('panel');
  if(p) p.classList.remove('is-leaving');
  render(s);
});
W.on('close-anim',function(){var p=document.getElementById('panel');if(p)p.classList.add('is-leaving');});
W.on('mobile-mode',function(m){var p=document.getElementById('panel');if(!p)return;if(m)p.classList.add('mobile');else p.classList.remove('mobile');});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(document.getElementById('overlay').classList.contains('open')){closeOverlay();}else{close_();}}});
</script>
</body>
</html>`;
    }

    let resultsSessionId = Math.random().toString(36).slice(2);

    const wvState = ctx.state<WebviewState>({
      results: [],
      loading: false,
      error: null,
      episodeInfo: '',
      timeTakenMs: null,
      animeLookupMs: null,
      searchMs: null,
      fromCache: false,
      errors: [],
      statistics: [],
      lookup: null,
      sessionId: resultsSessionId,
      autoPlay: false,
    });

    const pendingAnime = ctx.state<$app.AL_BaseAnime | null>(null);
    const pendingEp = ctx.state<$app.Anime_Episode | number | null>(null);

    interface DownloadRecord {
      index: number;
      filename: string;
      filePath: string;
      status: 'downloading' | 'completed' | 'error' | 'cancelled';
      error?: string;
      startedAt: number;
      completedAt?: number;
      percentage: number;
      downloadId: string;
      dismissHandlerId: string;
      cancelHandlerId: string;
    }
    const activeDownloadIndices = new Set<number>();
    const downloadRecords: DownloadRecord[] = [];
    let lastCacheKey: string | null = null;

    const clearFinishedHandlerId = ctx.eventHandler(
      'aio-clear-finished',
      () => {
        const toRemove = downloadRecords.filter(
          (r) => r.status !== 'downloading'
        );
        for (const r of toRemove) {
          downloadRecords.splice(downloadRecords.indexOf(r), 1);
        }
        tray.update();
      }
    );

    const ANIM_MS = 280;
    const VP_WIDTH = 520;

    const resultsWv = ctx.newWebview({
      slot: 'fixed',
      width: `${VP_WIDTH}px`,
      height: '98vh',
      hidden: true,
      zIndex: 100000,
      style: `color-scheme: dark; background: transparent; left: calc(100vw - ${VP_WIDTH}px - 10px); top: 10px`,
      window: {
        defaultPosition: 'top-right',
        frameless: true,
      },
    });

    resultsWv.setContent(() => getResultsHtml());
    resultsWv.channel.sync('state', wvState);

    const mobileState = ctx.state<boolean>(false);
    resultsWv.channel.sync('mobile-mode', mobileState);

    let pendingHideCancel: (() => void) | null = null;
    let lastAppliedMobile = false;
    let viewportWidth = 0;
    let viewportHeight = 0;
    let suppressOutsideCloseUntil = 0;
    try {
      const size = ctx.dom.viewport.getSize();
      viewportWidth = size.width;
      viewportHeight = size.height;
    } catch {}

    function isMobileViewport(): boolean {
      return viewportWidth < 768;
    }

    // Returns true if setOptions was actually called. Callers that follow up
    // with show() use the return value to decide whether to wait for the
    // iframe to re-render at the new size before revealing it.
    function applyViewportSize(): boolean {
      const mobile = isMobileViewport();
      if (mobile === lastAppliedMobile) return false;
      lastAppliedMobile = mobile;
      mobileState.set(mobile);
      try {
        resultsWv.setOptions(
          mobile
            ? {
                width: 'calc(100vw - 20px)',
                height: '95dvh',
                style:
                  'color-scheme: dark; background: transparent; left: 10px; top: calc(100dvh - 95dvh)',
                window: { frameless: true, defaultPosition: 'bottom-left' },
              }
            : {
                width: `${VP_WIDTH}px`,
                height: '98vh',
                style: `color-scheme: dark; background: transparent; left: calc(100vw - ${VP_WIDTH}px - 10px); top: 10px`,
                window: { frameless: true, defaultPosition: 'top-right' },
              }
        );
      } catch {}
      return true;
    }

    try {
      ctx.dom.viewport.onResize((size) => {
        viewportWidth = size.width;
        viewportHeight = size.height;
        applyViewportSize();
      });
    } catch {}

    function getPanelRect(): {
      left: number;
      top: number;
      right: number;
      bottom: number;
    } {
      const width = lastAppliedMobile
        ? Math.max(viewportWidth - 20, 0)
        : VP_WIDTH;
      const height = lastAppliedMobile
        ? Math.max(Math.round(viewportHeight * 0.95), 0)
        : Math.max(Math.round(viewportHeight * 0.98), 0);
      const left = lastAppliedMobile
        ? 10
        : Math.max(viewportWidth - width - 10, 0);
      const top = lastAppliedMobile ? Math.max(viewportHeight - height, 0) : 10;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
      };
    }

    function handleOutsideClick(event: any): void {
      if (resultsWv.isHidden()) return;
      if (Date.now() < suppressOutsideCloseUntil) return;

      const x = Number(event?.clientX);
      const y = Number(event?.clientY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const rect = getPanelRect();
      const inside =
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (!inside) {
        hideResultsAnimated();
      }
    }

    try {
      ctx.dom.observe('body', (elements) => {
        for (const el of elements) {
          if (el.attributes['data-aio-outside-click']) continue;
          el.setAttribute('data-aio-outside-click', '1');
          el.addEventListener('click', handleOutsideClick);
        }
      });
    } catch {}

    function showResults(): void {
      if (pendingHideCancel) {
        pendingHideCancel();
        pendingHideCancel = null;
      }
      suppressOutsideCloseUntil = Date.now() + 250;
      if (applyViewportSize()) {
        ctx.setTimeout(() => resultsWv.show(), 150);
      } else {
        resultsWv.show();
      }
    }

    function hideResultsAnimated(): void {
      if (pendingHideCancel) pendingHideCancel();
      resultsWv.channel.send('close-anim', {});
      pendingHideCancel = ctx.setTimeout(() => {
        resultsWv.hide();
        pendingHideCancel = null;
      }, ANIM_MS + 20);
    }

    ctx.screen.onNavigate((e) => {
      if (e.pathname !== '/entry') {
        hideResultsAnimated();
      }
    });

    function playStreamAtIndex(index: number): void {
      const result = wvState.get().results[index];
      if (!result) return;
      const anime = pendingAnime.get();
      const ep = pendingEp.get();
      if (!anime || !ep) return;
      const episodeNumber = typeof ep === 'number' ? ep : ep.episodeNumber;
      const aniDBEpisode =
        typeof ep === 'number'
          ? String(ep)
          : (ep.aniDBEpisode ?? String(ep.episodeNumber));

      const playerMode = getPlayerModePref();
      const title = anime.title?.userPreferred ?? 'Unknown';
      const windowTitle = `${title} - Episode ${episodeNumber}`;

      const urlTypes = ['http', 'usenet', 'debrid', 'live', 'info'] as const;
      const isUrlType = (urlTypes as readonly string[]).includes(result.type);

      if (isUrlType) {
        if (!result.url) return;

        if (playerMode === 'external') {
          ctx.externalPlayerLink.open(result.url, anime.id, episodeNumber);
          hideResultsAnimated();
          resultsWv.channel.send('play-error', { index });
          return;
        }

        const playPromise =
          playerMode === 'builtin'
            ? ctx.videoCore.playStream(result.url, aniDBEpisode, anime)
            : ctx.playback.streamUsingMediaPlayer(
                windowTitle,
                result.url,
                anime,
                aniDBEpisode
              );

        playPromise
          .then(() => {
            hideResultsAnimated();
          })
          .catch((err: Error) => {
            ctx.toast.error(`Playback error: ${err.message}`);
            resultsWv.channel.send('play-error', { index });
            const st = wvState.get();
            if (st.autoPlay) {
              wvState.set({ ...st, autoPlay: false });
            }
          });
      } else if (result.type === 'p2p') {
        if (!result.infoHash) return;

        if (!ctx.torrentstream.isEnabled()) {
          ctx.toast.error('Torrent streaming is not enabled');
          resultsWv.channel.send('play-error', { index });
          return;
        }

        const torrentstreamPlaybackType: $ui.TorrentstreamPlaybackType =
          playerMode === 'builtin'
            ? 'nativeplayer'
            : playerMode === 'external'
              ? 'externalPlayerLink'
              : 'default';

        const torrent: $app.HibikeTorrent_AnimeTorrent = {
          name: result.folderName ?? result.filename ?? '',
          date: '',
          size: result.size ?? 0,
          formattedSize: '',
          seeders: result.seeders ?? 0,
          leechers: 0,
          downloadCount: 0,
          link: result.magnetLink ?? '',
          downloadUrl: result.magnetLink ?? '',
          magnetLink: result.magnetLink ?? undefined,
          infoHash: result.infoHash,
          isBestRelease: false,
          confirmed: false,
        };

        let clientId: string | undefined = undefined;
        if (torrentstreamPlaybackType === 'nativeplayer') {
          const clientIds = $app.getClientIds();
          const platforms = clientIds.map((id) => $app.getClientPlatform(id));
          clientId = clientIds.find((id, idx) => platforms[idx] === 'denshi');
          if (!clientId) {
            ctx.toast.error(
              'No active compatible client found. Need Denshi client, but only found: ' +
                platforms.join(', ')
            );
            resultsWv.channel.send('play-error', { index });
            return;
          }
        }

        ctx.torrentstream
          .startStream({
            mediaId: anime.id,
            episodeNumber,
            aniDbEpisode: aniDBEpisode,
            fileIndex: result.fileIdx ?? undefined,
            autoSelect: result.fileIdx == null,
            playbackType: torrentstreamPlaybackType,
            torrent,
            clientId,
          })
          .then(() => {
            hideResultsAnimated();
          })
          .catch((err: Error) => {
            ctx.toast.error(`Torrent stream error: ${err.message}`);
            resultsWv.channel.send('play-error', { index });
            const st = wvState.get();
            if (st.autoPlay) {
              wvState.set({ ...st, autoPlay: false });
            }
          });
      }
    }

    resultsWv.channel.on('play', (data: { index: number }) => {
      playStreamAtIndex(data.index);
    });

    resultsWv.channel.on('copy-stream', (data: { text: string }) => {
      ctx.dom.clipboard.write(data.text);
      ctx.toast.success('Copied to clipboard!');
    });

    resultsWv.channel.on('download', (data: { index: number }) => {
      if (activeDownloadIndices.has(data.index)) return;

      const sessionId = resultsSessionId;
      const result = wvState.get().results[data.index];
      const url = result?.url ?? result?.externalUrl;
      if (!url) return;

      let filename =
        result.filename ??
        url.split('/').pop()?.split('?')[0]?.split('#')[0] ??
        '';
      if (!filename || !filename.includes('.')) {
        const sanitised = (result.name ?? 'download').replace(
          /[/\\:*?"<>|]/g,
          '_'
        );
        filename = sanitised + '.mp4';
      }

      const baseDir = result.folderName
        ? $filepath.join(
            resolveDownloadDir(),
            result.folderName.replace(/[/\\:*?"<>|]/g, '_')
          )
        : resolveDownloadDir();
      const filePath = $filepath.join(baseDir, filename);
      activeDownloadIndices.add(data.index);

      const downloadId = ctx.downloader.download(url, filePath);

      const dismissHandlerId = ctx.eventHandler(
        `aio-dismiss-${downloadId}`,
        () => {
          const idx = downloadRecords.findIndex(
            (r) => r.downloadId === downloadId
          );
          if (idx !== -1) downloadRecords.splice(idx, 1);
          tray.update();
        }
      );
      const cancelHandlerId = ctx.eventHandler(
        `aio-cancel-${downloadId}`,
        () => {
          ctx.downloader.cancel(downloadId);
        }
      );

      const record: DownloadRecord = {
        index: data.index,
        filename,
        filePath,
        status: 'downloading',
        startedAt: Date.now(),
        percentage: 0,
        downloadId,
        dismissHandlerId,
        cancelHandlerId,
      };
      downloadRecords.unshift(record);
      if (downloadRecords.length > 8) downloadRecords.splice(8);

      // Send initial state to webview immediately so the button updates
      resultsWv.channel.send('download-progress', {
        index: data.index,
        sessionId,
        status: 'downloading',
        percentage: 0,
        filename,
        filePath,
      });
      tray.update();

      ctx.downloader.watch(
        downloadId,
        (progress: $downloader.DownloadProgress | undefined) => {
          if (!progress) return;
          const { percentage, speed, error } = progress;
          const status = progress.status;
          record.percentage = percentage ?? 0;

          // Forward live progress to webview
          resultsWv.channel.send('download-progress', {
            index: data.index,
            sessionId,
            status,
            percentage,
            speed,
            filename,
            filePath,
            error,
          });

          if (
            status === 'completed' ||
            status === 'error' ||
            status === 'cancelled'
          ) {
            activeDownloadIndices.delete(data.index);
            record.status = status as DownloadRecord['status'];
            record.completedAt = Date.now();
            if (error) record.error = error;
            tray.update();

            if (status === 'completed') {
              ctx.toast.success(`Downloaded to: ${filePath}`);
            } else if (status === 'error') {
              ctx.toast.error(`Download failed: ${error ?? 'Unknown error'}`);
            }
          }
        }
      );
    });

    resultsWv.channel.on('close', (_: unknown) => {
      hideResultsAnimated();
    });

    resultsWv.channel.on('retry', (_: unknown) => {
      const anime = pendingAnime.get();
      const ep = pendingEp.get();
      if (anime && ep) {
        fetchStreams(anime, ep);
      }
    });

    resultsWv.channel.on('refresh', (_: unknown) => {
      if (lastCacheKey) {
        const store =
          $storage.get<Record<string, { results: StreamResult[]; ts: number }>>(
            SK_CACHE_STORE
          ) ?? {};
        delete store[lastCacheKey];
        $storage.set(SK_CACHE_STORE, store);
      }
      const anime = pendingAnime.get();
      const ep = pendingEp.get();
      if (anime && ep) {
        fetchStreams(anime, ep);
      }
    });

    function getCacheStats(): { count: number } {
      const store =
        $storage.get<Record<string, { results: StreamResult[]; ts: number }>>(
          SK_CACHE_STORE
        ) ?? {};
      return { count: Object.keys(store).length };
    }

    function getConfigureUrl(): string | null {
      const url = ($getUserPreference('manifestUrl') ?? '').trim();
      if (!url) return null;
      try {
        parseManifestUrl(url);
      } catch {
        return null;
      }
      return url.replace(/\/manifest\.json(\?.*)?$/, '/configure$1');
    }

    const clearCacheHandlerId = ctx.eventHandler('aio-clear-cache', () => {
      clearCache();
      ctx.toast.success('AIOStreams cache cleared!');
      tray.update();
    });

    const reopenPanelHandlerId = ctx.eventHandler('aio-reopen-panel', () => {
      const st = wvState.get();
      const hasResults = st.results.length > 0;
      if (!hasResults && !st.error) {
        ctx.toast.info('No previous results to show.');
        return;
      }

      if (st.autoPlay) {
        wvState.set({ ...st, autoPlay: false });
      }

      showResults();
      tray.close();
    });

    const refreshHandlerId = ctx.eventHandler('aio-refresh-tray', () => {
      tray.update();
    });

    const tray = ctx.newTray({
      iconUrl:
        'https://cdn.jsdelivr.net/gh/selfhst/icons/png/aiostreams-light.png',
      withContent: true,
      width: '260px',
      minHeight: '80px',
    });

    tray.onOpen(() => tray.update());

    tray.render(() => {
      const stats = getCacheStats();
      const configureUrl = getConfigureUrl();
      const lastState = wvState.get();
      const hasLastResults =
        lastState.results.length > 0 || lastState.error !== null;

      const items: unknown[] = [
        tray.text('AIOStreams', {
          style: { fontWeight: '600', fontSize: '14px' },
        }),
        tray.text(
          stats.count === 0
            ? 'Cache is empty'
            : `${stats.count} cached ${stats.count === 1 ? 'lookup' : 'lookups'}`,
          { style: { fontSize: '12px', color: 'rgba(255,255,255,0.5)' } }
        ),
      ];

      if (hasLastResults) {
        items.push(
          tray.button('Reopen last results', {
            onClick: reopenPanelHandlerId,
            intent: 'primary-subtle',
            size: 'sm',
          })
        );
      }

      items.push(
        tray.button('Clear Cache', {
          onClick: clearCacheHandlerId,
          intent: 'gray-subtle',
          size: 'sm',
        })
      );

      if (downloadRecords.length > 0) {
        items.push(
          tray.div([], {
            style: {
              borderTop: '1px solid rgba(255,255,255,0.08)',
              marginTop: '2px',
              marginBottom: '2px',
            },
          })
        );
        const hasFinished = downloadRecords.some(
          (r) => r.status !== 'downloading'
        );
        items.push(
          tray.flex(
            [
              tray.text('Downloads', {
                style: {
                  fontSize: '11px',
                  fontWeight: '600',
                  color: 'rgba(255,255,255,0.4)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                },
              }),
              ...(hasFinished
                ? [
                    tray.button('Clear done', {
                      onClick: clearFinishedHandlerId,
                      intent: 'gray-subtle',
                      size: 'sm',
                    }),
                  ]
                : []),
            ],
            {
              style: {
                justifyContent: 'space-between',
                alignItems: 'center',
              },
            }
          )
        );

        for (const record of downloadRecords) {
          const isActive = record.status === 'downloading';
          const badgeText = isActive
            ? `${Math.round(record.percentage)}%`
            : record.status === 'completed'
              ? 'Done'
              : record.status === 'error'
                ? 'Error'
                : 'Stopped';
          const badgeIntent: 'info' | 'success' | 'alert' | 'gray' = isActive
            ? 'info'
            : record.status === 'completed'
              ? 'success'
              : record.status === 'error'
                ? 'alert'
                : 'gray';

          items.push(
            tray.flex(
              [
                tray.text(record.filename, {
                  className: 'text-xs truncate min-w-0 flex-1 text-[--gray]',
                }),
                tray.flex(
                  [
                    tray.badge({ text: badgeText, intent: badgeIntent }),
                    tray.button(isActive ? 'Stop' : '×', {
                      onClick: isActive
                        ? record.cancelHandlerId
                        : record.dismissHandlerId,
                      intent: 'gray-subtle',
                      size: 'sm',
                    }),
                  ],
                  {
                    style: {
                      gap: '4px',
                      alignItems: 'center',
                      flexShrink: '0',
                    },
                  }
                ),
              ],
              { style: { alignItems: 'center', gap: '6px', width: '100%' } }
            )
          );
        }
      }

      if (configureUrl) {
        items.push(
          tray.anchor({
            text: 'Configure',
            href: configureUrl,
            target: '_blank',
            className:
              'bg-gray-100 border border-transparent hover:bg-gray-200 active:bg-gray-300 dark:bg-opacity-10 dark:hover:bg-opacity-20 text-[rgb(125,140,255)] text-sm font-medium px-3 py-1.5 rounded-md transition-colors no-underline inline-flex items-center justify-center',
          })
        );
      } else {
        items.push(
          tray.text('Manifest URL not configured', {
            style: { fontSize: '12px', color: 'rgb(248,113,113)' },
          })
        );
      }

      return tray.stack({ items, gap: 2 });
    });

    // Keep tray fresh when results change (so "Reopen last results" stays accurate)
    ctx.effect(() => {
      tray.update();
    }, [wvState]);
    void refreshHandlerId;

    async function fetchStreams(
      anime: $app.AL_BaseAnime,
      episode: $app.Anime_Episode | number
    ): Promise<void> {
      const episodeNumber =
        typeof episode === 'number' ? episode : episode.episodeNumber;
      const manifestUrl = $getUserPreference('manifestUrl') ?? '';
      const searchId = ($getUserPreference('searchId') ?? 'imdbId') as
        | 'imdbId'
        | 'kitsuId'
        | 'anilistId';

      let creds: ParsedManifestCredentials;
      try {
        creds = parseManifestUrl(manifestUrl);
      } catch {
        ctx.toast.error(
          'AIOStreams manifest URL is invalid or missing. Configure it in the extension settings.'
        );
        return;
      }

      const animeTitle = anime.title?.userPreferred ?? 'Unknown';
      const isMovie = String(anime.format ?? '').toUpperCase() === 'MOVIE';
      const episodeInfo = isMovie
        ? animeTitle
        : `${animeTitle} \xb7 Episode ${episodeNumber}`;
      const mediaType = isMovie ? 'movie' : 'series';

      pendingAnime.set(anime);
      pendingEp.set(episode);

      const autoPlay = prefBool('autoPlayFirstStream', false);

      resultsSessionId = Math.random().toString(36).slice(2);
      activeDownloadIndices.clear();
      wvState.set({
        results: [],
        loading: true,
        error: null,
        episodeInfo,
        timeTakenMs: null,
        animeLookupMs: null,
        searchMs: null,
        fromCache: false,
        errors: [],
        statistics: [],
        lookup: null,
        sessionId: resultsSessionId,
        autoPlay,
      });
      showResults();

      const startTime = Date.now();
      let animeLookupMs: number | null = null;
      let searchMs: number | null = null;

      console.log('Received request for streams:', {
        animeId: anime.id,
        episodeNumber,
        searchId,
      });

      console.log('Full anime object:', anime);
      console.log('Full episode object:', episode);

      let parsedId: ParsedId | null = null;

      if (
        anime.siteUrl?.startsWith('ext_custom_source_stremio-custom-source')
      ) {
        const parts = anime.siteUrl.split('|');
        if (parts.length === 3) {
          try {
            const decoded = CryptoJS.enc.Utf8.stringify(
              CryptoJS.enc.Base64.parse(parts[2])
            );
            const parsed = JSON.parse(decoded);
            if (parsed && typeof parsed === 'object') {
              if (parsed.type !== 'series') {
                parsedId = {
                  type: 'stremioId',
                  value: parsed.imdb_id || parsed.id,
                };
              } else {
                const epMapping = parsed.episodes?.[String(episodeNumber)];
                const parsedStremioId = parseStremioId(epMapping ?? '');
                parsedId = {
                  type: 'stremioId',
                  value: parsedStremioId?.baseId,
                  season: parsedStremioId?.season,
                  episode: parsedStremioId?.episode,
                };
              }
            }
          } catch (err) {
            console.warn(
              'Failed to parse custom source ID, falling back to AniList ID',
              err
            );
          }
        }
      }
      if (!parsedId) {
        parsedId = {
          type: 'anilistId',
          value: String(anime.id),
          episode: isMovie ? undefined : episodeNumber,
        };
      }
      const originalId = { ...parsedId };

      if (parsedId.type !== 'stremioId') {
        const animeLookupStart = Date.now();
        try {
          const animeEntry = await aioAnime(
            creds.baseUrl,
            creds.uuid,
            creds.passwordToken,
            'anilistId',
            anime.id
          );
          animeLookupMs = Date.now() - animeLookupStart;
          if (animeEntry) {
            applyPreferredMapping(parsedId, animeEntry, searchId);
            if (isMovie) {
              parsedId.season = undefined;
              parsedId.episode = undefined;
            }
            console.log('Fetched anime details from AIOStreams:', animeEntry, {
              mappedId: parsedId,
            });
          }
        } catch (err: unknown) {
          animeLookupMs = Date.now() - animeLookupStart;
          console.warn(
            'Failed to fetch anime details from AIOStreams, falling back to AniList ID search',
            err
          );
          // Non-fatal — fall back to AniList ID
        }
      }

      const lookup: LookupInfo = {
        original: `${originalId.type}: ${originalId.value}${originalId.season !== undefined ? ` · S${originalId.season}` : ''}${originalId.episode !== undefined ? ` · E${originalId.episode}` : ''}${anime.format ? ` (${anime.format})` : ''}`,
        resolved: `${parsedId.type}: ${parsedId.value}${parsedId.season !== undefined ? ` · S${parsedId.season}` : ''}${parsedId.episode !== undefined ? ` · E${parsedId.episode}` : ''}${mediaType ? ` (${mediaType})` : ''}`,
        stremioId: `${formatIdForSearch(parsedId)}${parsedId.season !== undefined ? `:${parsedId.season}` : ''}${parsedId.episode !== undefined ? `:${parsedId.episode}` : ''}`,
      };
      if (parsedId.type === 'stremioId') {
        lookup.resolved = `—`;
      }

      // Check cache
      const cacheKey = getCacheKey(parsedId);
      lastCacheKey = cacheKey;
      const cachedResults = getCached(cacheKey);
      if (cachedResults) {
        console.log('cache HIT for', cacheKey, cachedResults);
        wvState.set({
          results: cachedResults,
          loading: false,
          error: null,
          episodeInfo,
          timeTakenMs: Date.now() - startTime,
          animeLookupMs,
          searchMs: null,
          fromCache: true,
          errors: [],
          statistics: [],
          lookup,
          sessionId: resultsSessionId,
          autoPlay: autoPlay && cachedResults.length > 0,
        });
        if (autoPlay && cachedResults.length > 0) {
          playStreamAtIndex(0);
        }
        return;
      }

      // Fetch from API
      const searchStart = Date.now();
      try {
        const searchResponse = await aioSearch(
          creds.baseUrl,
          creds.uuid,
          creds.passwordToken,
          mediaType,
          formatIdForSearch(parsedId),
          parsedId.season,
          parsedId.episode
        );
        searchMs = Date.now() - searchStart;
        const results = searchResponse.results.map(toStreamResult);
        setCached(cacheKey, results);
        wvState.set({
          results,
          loading: false,
          error: null,
          episodeInfo,
          timeTakenMs: Date.now() - startTime,
          animeLookupMs,
          searchMs,
          fromCache: false,
          errors: searchResponse.errors ?? [],
          statistics: searchResponse.statistics ?? [],
          lookup,
          sessionId: resultsSessionId,
          autoPlay: autoPlay && results.length > 0,
        });
        if (autoPlay && results.length > 0) {
          playStreamAtIndex(0);
        }
      } catch (err: unknown) {
        searchMs = Date.now() - searchStart;
        console.error('Error fetching streams from AIOStreams:', err);
        const msg = err instanceof Error ? err.message : String(err);
        wvState.set({
          results: [],
          loading: false,
          error: msg,
          episodeInfo,
          timeTakenMs: Date.now() - startTime,
          animeLookupMs,
          searchMs,
          fromCache: false,
          errors: [],
          statistics: [],
          lookup,
          sessionId: resultsSessionId,
          autoPlay: false,
        });
      }
    }

    function resolveDownloadDir(): string {
      const pref = (
        $getUserPreference('downloadLocation') ?? '$DOWNLOAD'
      ).trim();
      if (!pref) return $osExtra.downloadDir();

      const replacements: Array<[string, () => string]> = [
        ['$DOWNLOAD', () => $osExtra.downloadDir()],
        ['$DESKTOP', () => $osExtra.desktopDir()],
        ['$DOCUMENT', () => $osExtra.documentsDir()],
        ['$HOME', () => $os.homeDir()],
      ];

      for (const [token, getBase] of replacements) {
        if (pref.startsWith(token)) {
          const base = getBase();
          if (!base) continue;
          const rest = pref.slice(token.length).replace(/^[/\\]/, '');
          return rest ? $filepath.join(base, rest) : base;
        }
      }

      return pref; // treat as an absolute path
    }

    function prefBool(key: string, def: boolean): boolean {
      const v = $getUserPreference(key);
      if (v === undefined || v === null || v === '') return def;
      return v === 'true';
    }

    function getPlayerModePref(): 'desktop' | 'builtin' | 'external' {
      const mode = ($getUserPreference('playerMode') ?? '').trim();
      if (mode === 'desktop' || mode === 'builtin' || mode === 'external') {
        return mode;
      }

      if (prefBool('useExternalPlayer', false)) {
        return 'external';
      }

      return 'desktop';
    }

    const episodePalette = ctx.newCommandPalette({
      placeholder: 'Select an episode...',
    });

    const animeBtn = ctx.action.newAnimePageButton({
      label: 'AIOStreams',
      tooltipText: 'Stream with AIOStreams',
    });
    if (prefBool('showAnimePageButton', false)) {
      animeBtn.mount();
    }
    animeBtn.onClick(async ({ media }) => {
      animeBtn.setLoading(true);
      console.log('Anime page button clicked for', media);
      try {
        const entry = await ctx.anime.getAnimeEntry(media.id);
        const entryEpisodes = entry?.episodes ?? [];

        let items: {
          value: string;
          label: string;
          filterType: 'includes';
          onSelect: () => void;
        }[];

        const getEpisodeTitle = (ep: $app.Anime_Episode): string => {
          const base = `Episode ${ep.episodeNumber}`;
          const title = ep.displayTitle ?? ep.episodeTitle;
          return `${base}${title ? ` \u2013 ${title}` : ''}`;
        };

        if (entryEpisodes.length > 0) {
          items = entryEpisodes.map((ep) => ({
            value: String(ep.episodeNumber),
            label: getEpisodeTitle(ep),
            filterType: 'includes' as const,
            onSelect: () => {
              episodePalette.close();

              fetchStreams(media, ep);
            },
          }));
        } else {
          // Fallback: generate from AniList episode count
          const total =
            media.episodes ??
            (media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : 1);
          items = Array.from({ length: Math.max(total, 1) }, (_, i) => {
            const n = i + 1;
            return {
              value: String(n),
              label: `Episode ${n}`,
              filterType: 'includes' as const,
              onSelect: () => {
                episodePalette.close();
                fetchStreams(media, n);
              },
            };
          });
        }

        episodePalette.setItems(items);
        episodePalette.open();
      } catch {
        ctx.toast.error('Could not load episodes.');
      } finally {
        animeBtn.setLoading(false);
      }
    });

    function registerItem(
      item:
        | ReturnType<typeof ctx.action.newEpisodeGridItemMenuItem>
        | ReturnType<typeof ctx.action.newEpisodeCardContextMenuItem>
    ) {
      item.mount();
      item.onClick((event) => {
        const episode = event.episode;
        if ('number' in episode) {
          ctx.toast.error(
            'Onlinestream episodes are not supported by AIOStreams.'
          );
          return;
        }
        const anime = episode.baseAnime;
        if (!anime) {
          ctx.toast.error('Could not determine anime for this episode.');
          return;
        }
        fetchStreams(anime, episode);
      });
    }

    if (prefBool('showEpisodeContextMenu', true)) {
      registerItem(
        ctx.action.newEpisodeCardContextMenuItem({
          label: 'Stream with AIOStreams',
        })
      );
    }

    if (prefBool('showEpisodeGridMenu', true)) {
      const gridTypes = [
        'debridstream',
        'library',
        'torrentstream',
        'undownloaded',
        'medialinks',
        'mediastream',
      ] as const;
      for (const gridType of gridTypes) {
        registerItem(
          ctx.action.newEpisodeGridItemMenuItem({
            label: 'Stream with AIOStreams',
            type: gridType,
          })
        );
      }
    }

    const attachAutoOpenObserver = (selector: string) => {
      ctx.dom.observe(selector, (elements) => {
        for (const el of elements) {
          if (el.attributes['data-aio-observed']) continue;
          el.setAttribute('data-aio-observed', '1');

          const mediaId = parseInt(el.attributes['data-media-id'] ?? '0', 10);
          const episodeNumber = parseInt(
            el.attributes['data-episode-number'] ?? '0',
            10
          );
          if (!mediaId || !episodeNumber) continue;

          el.addEventListener('click', () => {
            const anime = $anilist.getAnime(mediaId);
            if (!anime) {
              ctx.toast.error('AIOStreams: Could not identify anime');
              return;
            }
            fetchStreams(anime, episodeNumber);
          });
        }
      });
    };

    if (prefBool('autoOpenResults', false)) {
      attachAutoOpenObserver('[data-episode-card]');
      attachAutoOpenObserver('[data-episode-grid-item]');
    }

    if (prefBool('showAnimeTab', true)) {
      const { name, icon, getIsOpen } = ctx.anime.registerEntryEpisodeTab({
        name: 'AIOStreams',
        icon: 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/aiostreams-light.png',
        shouldShow(event) {
          return true;
        },
        onEpisodeCollection(event) {
          const { mediaId, episodeCollection } = event;
          console.log(
            'Received episode collection for mediaId',
            mediaId,
            episodeCollection
          );
          return episodeCollection;
        },
        async onSelectEpisode(event) {
          const { mediaId, episodeNumber, aniDbEpisode, episode } = event;

          let ep: $app.Anime_Episode | number = episode || episodeNumber;
          let anime: $app.AL_BaseAnime | undefined = undefined;
          if (episode?.baseAnime) {
            anime = episode.baseAnime;
          } else if (mediaId) {
            const entry = await ctx.anime.getAnimeEntry(mediaId);
            if (entry) {
              anime = entry.media;
            } else {
              anime = $anilist.getAnime(mediaId);
            }
          }
          if (!anime) {
            ctx.toast.error('AIOStreams: Could not identify anime');
            return;
          }

          fetchStreams(anime, ep);
        },
      });
    }
  });
}

(globalThis as Record<string, unknown>).init = init;
