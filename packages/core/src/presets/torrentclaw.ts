import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { constants, ServiceId } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser } from '../parser/index.js';

/**
 * TorrentClaw publishes machine-readable stream metadata in `behaviorHints`, so
 * this parser reads flags instead of scraping the human-facing title text.
 *
 * The base parser derives the service (and with it `cached`) from
 * `parseServiceData(stream.name)`, which looks for a provider name — "RD",
 * "TorBox", … — in the stream name. TorrentClaw never names the provider there:
 * the user picks the debrid provider in their own addon config, so the name only
 * carries the playback state and the quality tier ("⚡️ INSTANT 1080p",
 * "⬇️ Download 1080p"). The provider regex therefore never matches, the service
 * comes back `undefined`, and three things go wrong downstream:
 *
 *   - `sorter.ts` treats a stream with no service as cached, so cache-on-demand
 *     entries sort in among the instant ones;
 *   - the `cached()` stream expression drops genuinely-cached entries, since it
 *     tests `=== true`;
 *   - `getStreamType` falls through to `http` instead of `debrid`.
 *
 * `behaviorHints.cached` is authoritative — TorrentClaw sets it from a verified
 * provider cache check, on every playable entry.
 */
class TorrentClawStreamParser extends StreamParser {
  /**
   * `behaviorHints.cached` is a boolean on every playable stream, and also on
   * the download landings (which are real releases behind a click, so `false`).
   * Only the pure notices omit it.
   *
   * `behaviorHints` is a loose object in the schema, hence the cast — the same
   * approach `streamnzb.ts` uses for this field.
   */
  private static readCachedHint(stream: Stream): boolean | undefined {
    const cached = (stream.behaviorHints as { cached?: boolean } | undefined)
      ?.cached;
    return typeof cached === 'boolean' ? cached : undefined;
  }

  protected override getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    const hints = stream.behaviorHints as
      | { tcAction?: string; tcSource?: string }
      | undefined;

    // A non-playable card is served by nobody, so it gets no service. Worth
    // stating rather than leaving to the base heuristic, which scans the name
    // for provider names and produces false positives against ordinary prose:
    // the Spanish "Ver EN tu navegador" matches Easynews' known name "EN",
    // attributing our own notice to a service the user may not even have.
    if (hints?.tcAction !== undefined) {
      return undefined;
    }

    const service = super.getService(stream, currentParsedStream);
    const cached = TorrentClawStreamParser.readCachedHint(stream);
    if (cached === undefined) {
      return service;
    }

    // The hint wins over the emoji heuristic whenever both are present.
    if (service) {
      return { ...service, cached };
    }

    // No provider name in the stream name — the usual case. Attribute the
    // stream to the configured service so `cached` is honoured downstream.
    //
    // ONLY for debrid deliveries. A `service` means "this provider served the
    // stream", so attaching one to a swarm or usenet entry is simply false, and
    // `filterer.ts` acts on it: `excludeUncached` drops anything with
    // `service.cached === false`, so attributing the P2P entries would delete
    // results that survive today, and `excludeCachedFromServices` would blame
    // the wrong provider. Non-debrid entries keep their delivery in
    // `getStreamType` and stay unattributed here, as they should.
    if (hints?.tcSource !== 'debrid') {
      return service;
    }

    // And only when the service is UNAMBIGUOUS: `main/setup.ts` rewrites
    // `options.services` (to `[]`, and to a filtered list under service-wrap),
    // so it can legitimately arrive empty or with several entries. Guessing
    // which of several providers served a stream would drop results the same
    // way, so stay silent instead.
    const services = this.addon.preset?.options?.services as
      | ServiceId[]
      | undefined;
    if (services?.length !== 1) {
      return service;
    }
    return { id: services[0], cached };
  }

  /**
   * Usenet and library entries are served over HTTP with no debrid service
   * attached, so the base implementation classifies them as `http`. TorrentClaw
   * tags the delivery mechanism on `behaviorHints.tcSource`, which is read here
   * rather than inferred from the URL shape or the title text.
   *
   * Older addon versions do not send it; those fall through to the base
   * behaviour, which is what happens today.
   */
  protected override getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    const source = (stream.behaviorHints as { tcSource?: string } | undefined)
      ?.tcSource;

    // `usenet` only with a service attributed. The deduplicator re-labels a
    // usenet stream to cached/uncached ONLY when it has one; without a service
    // the type stays 'usenet', and `DeduplicatorOptions` has no `usenet` key, so
    // the mode is undefined, no branch of the switch matches, and the stream is
    // dropped silently — neither processed nor a winner. TorrentClaw serves
    // usenet through the user's own agent rather than a debrid service, so that
    // combination is the norm here, not an edge case.
    if (source === 'usenet' && service) {
      return constants.USENET_STREAM_TYPE;
    }

    // Only claim p2p when there is actually a hash to swarm: the Stremio
    // transformer passes `infoHash` and drops `url` for this type, so a p2p
    // stream without one reaches the client with neither — a card that silently
    // plays nothing. Without a hash, let the base classify it by shape.
    if (source === 'p2p' && stream.infoHash) {
      return constants.P2P_STREAM_TYPE;
    }

    return super.getStreamType(stream, service, currentParsedStream);
  }

  /**
   * `tcSource: "library"` means the file already sits on the user's own machine,
   * which is exactly what `library` marks here. Both the sorter and the
   * deduplicator prefer a library copy when picking between duplicates, and it
   * is the right winner: nothing has to be fetched to play it.
   */
  protected override getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    const source = (stream.behaviorHints as { tcSource?: string } | undefined)
      ?.tcSource;
    return (
      source === 'library' || super.getInLibrary(stream, currentParsedStream)
    );
  }

  /**
   * Two opt-in filters, both keyed on flags rather than on the entry's wording.
   *
   * `hideActionCards` drops the non-playable entries: notices explaining why a
   * title has no sources, the "watch in browser" link and the download landings.
   * Every one of them carries `behaviorHints.tcAction`, and playable entries
   * never do, so the flag's mere presence identifies them.
   *
   * `excludeP2P` drops swarm results, which TorrentClaw returns alongside the
   * debrid ones in the same response.
   */
  protected override shouldSkip(stream: Stream): boolean {
    if (super.shouldSkip(stream)) {
      return true;
    }
    const options = this.addon.preset?.options;
    const hints = stream.behaviorHints as
      | { tcAction?: string; tcSource?: string }
      | undefined;

    if (options?.hideActionCards && hints?.tcAction !== undefined) {
      return true;
    }
    if (options?.excludeP2P && hints?.tcSource === 'p2p') {
      return true;
    }
    return false;
  }
}

export class TorrentClawPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return TorrentClawStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.PREMIUMIZE_SERVICE,
    ];

    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'TorrentClaw',
        supportedResources,
        appConfig.presets.torrentclaw.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        appConfig.presets.torrentclaw.url
      ),
      {
        id: 'apiKey',
        name: 'API Key',
        description:
          'Your TorrentClaw API key. Optional — without it the addon returns free-tier results. A PRO key unlocks debrid playback, the full catalogue and the higher rate limit.',
        type: 'password',
        required: false,
      },
      {
        id: 'lang',
        name: 'Preferred Language',
        description:
          'Preferred audio language. Results in this language are sorted first. Accepts a plain code (es, en) or a regional variant (es-ES, es-419, pt-BR).',
        type: 'string',
        required: false,
        showInSimpleMode: false,
      },
      {
        id: 'hideActionCards',
        name: 'Hide Informational Results',
        description:
          "TorrentClaw returns informational entries alongside real streams: why a title has no sources, a link to watch it in the browser, and download landings. They explain an otherwise empty list, but inside an aggregator they compete with other addons' results.",
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'excludeP2P',
        name: 'Exclude P2P Results',
        description:
          'Drop direct torrent (P2P) results and keep only the debrid, usenet and library ones. TorrentClaw always returns P2P alongside the rest, so this filters the response rather than changing the request.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used. TorrentClaw picks the provider from your account, so selecting exactly one here lets results be attributed to it — leaving several selected keeps them unattributed rather than guessing wrong.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        required: false,
        socials: [{ id: 'website', url: 'https://torrentclaw.com' }],
      },
    ];

    return {
      ID: 'torrentclaw',
      NAME: 'TorrentClaw',
      LOGO: 'https://torrentclaw.com/icon-512.png',
      URL: appConfig.presets.torrentclaw.url,
      TIMEOUT:
        appConfig.presets.torrentclaw.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.torrentclaw.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'Torrent and debrid streams from TorrentClaw, an aggregator that merges several indexers, deduplicates by info hash and scores each release by quality.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
        constants.USENET_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  static override async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    // A user-supplied manifest URL is already fully configured — pass it through
    // untouched rather than rebuilding a config on top of it.
    if (options.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServices = this.getUsableServices(
      userData,
      options.services,
      options.name
    );

    // ALWAYS a single instance, unlike most debrid presets — because for
    // TorrentClaw a second one would be the same request twice.
    //
    // Presets like Comet put each provider's own credentials in the manifest
    // URL, so one instance per service is one distinct endpoint per service.
    // TorrentClaw instead resolves the provider from the account behind the API
    // key, and the config blob carries no provider field a third party could
    // set (the addon's own `debrid` option holds a token encrypted with the
    // site's key). So every instance built from the same options produces a
    // byte-identical manifest URL: N instances would issue N copies of one
    // request and duplicate every result — P2P, debrid and usenet alike, not
    // just the P2P ones.
    //
    // The response already contains all of them together (verified against the
    // live addon, with and without an API key), so `excludeP2P` narrows it in
    // the parser instead of by making another request.
    return [
      this.generateAddon(
        userData,
        options,
        (usableServices ?? []).map((service) => service.id)
      ),
    ];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    services: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | '),
      identifier:
        services.length > 0
          ? services.length > 1
            ? 'multi'
            : constants.SERVICE_DETAILS[services[0]].shortName
          : options.url?.endsWith('/manifest.json')
            ? undefined
            : 'p2p',
      manifestUrl: this.generateManifestUrl(userData, options, services),
      enabled: true,
      mediaTypes: options.mediaTypes || [],
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: { ...options, services },
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(
    userData: UserData,
    options: Record<string, any>,
    services: ServiceId[]
  ): string {
    const url = options.url || this.DEFAULT_URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    const config: Record<string, any> = {};
    if (options.apiKey) {
      config.apiKey = options.apiKey;
    }
    if (options.lang) {
      config.lang = options.lang;
    }

    // TorrentClaw resolves the debrid provider from the account behind the API
    // key, so the service list is not part of the config blob. It is still
    // carried on the addon (`preset.options.services`) for stream attribution.
    void services;

    const base = url.replace(/\/$/, '');

    // With nothing to configure, request the bare manifest. An empty config
    // still base64-encodes to a 3-character segment ("e30"), which the addon
    // does not recognise as a config blob — it answers 200 with
    // `{"error":"Unknown endpoint"}` rather than a manifest.
    if (Object.keys(config).length === 0) {
      return `${base}/manifest.json`;
    }

    // base64url of the plain JSON config, as the addon's own configure page
    // generates it.
    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${base}/${configString}/manifest.json`;
  }
}
