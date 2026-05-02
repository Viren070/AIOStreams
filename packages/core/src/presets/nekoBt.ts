import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import { convertLangCodeToName, mapLanguageCode } from '../utils/languages.js';
import StreamParser from '../parser/streams.js';
import { Env, constants } from '../utils/index.js';
import { BuiltinStreamParser } from './builtin.js';
import { baseOptions } from './preset.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';

export class NekoBtStreamParser extends BuiltinStreamParser {
  private static TAGS_REGEX = /\{Tags:\s*([^}]*)\}\s*$/i;

  // nekoBT omits the dash in regional language codes; map them to proper BCP 47
  private static LANG_CODE_MAP: Record<string, string> = {
    frfr: 'fr-FR',
    ptbr: 'pt-BR',
    ptpt: 'pt-PT',
    eses: 'es-ES',
    es419: 'es-419',
    zhhans: 'zh-Hans',
    zhhant: 'zh-TW',
  };

  // Video quality mapping (indexes per nekoBT comment)
  // Each index corresponds to the numeric ID used by nekoBT tags.
  // aiostreamsName maps to one of the canonical QUALITIES where possible.
  private static VIDEO_QUALITY_MAP: Array<
    { label: string; aiostreamsName?: string } | undefined
  > = [
    /* 0 */ { label: 'Other' },
    /* 1 */ { label: 'VHS' },
    /* 2 */ { label: 'LaserDisc' },
    /* 3 */ { label: 'TV - Encode', aiostreamsName: 'HDTV' },
    /* 4 */ { label: 'TV - Raw', aiostreamsName: 'HDTV' },
    /* 5 */ { label: 'DVD - Remux', aiostreamsName: 'DVDRip' },
    /* 6 */ { label: 'DVD - Encode', aiostreamsName: 'DVDRip' },
    /* 7 */ { label: 'WEB - Mini', aiostreamsName: 'WEBRip' },
    /* 8 */ { label: 'WEB - Encode', aiostreamsName: 'WEBRip' },
    /* 9 */ { label: 'WEB-DL', aiostreamsName: 'WEB-DL' },
    /*10 */ undefined,
    /*11 */ { label: 'BD - Disc', aiostreamsName: 'BluRay' },
    /*12 */ { label: 'BD - Mini', aiostreamsName: 'BluRay' },
    /*13 */ { label: 'BD - Encode', aiostreamsName: 'BluRay' },
    /*14 */ { label: 'BD - Remux', aiostreamsName: 'BluRay REMUX' },
    /*15 */ { label: 'Hybrid', aiostreamsName: 'BluRay' },
    /*16 */ { label: 'DVD - Disc', aiostreamsName: 'DVDRip' },
  ];

  private static VIDEO_CODEC_MAP: Array<{
    name: string;
    aiostreamsName?: string;
  }> = [
    { name: 'Other' },
    { name: 'H264', aiostreamsName: 'AVC' },
    { name: 'H265', aiostreamsName: 'HEVC' },
    { name: 'AV1', aiostreamsName: 'AV1' },
    { name: 'VP9' },
    { name: 'MPEG-2' },
    { name: 'MPEG-4' },
    { name: 'WMV' },
    { name: 'VC1' },
  ];

  private static normalizeNekoBtLangCode(code: string): string {
    return NekoBtStreamParser.LANG_CODE_MAP[code.toLowerCase()] ?? code;
  }

  private extractTagsFromString(input: string): Record<string, any> {
    const result: Record<string, any> = {};
    if (!input) return result;
    const m = input.match(NekoBtStreamParser.TAGS_REGEX);
    if (!m) return result;

    const inner = m[1];
    // tokens separated by semicolon (commas are used inside language lists)
    const tokens = inner
      .split(/[;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const token of tokens) {
      // Token like L3 or V8 or C2 or A-ja or F-en or S-en
      if (/^L\d+$/.test(token)) {
        result.subLevel = parseInt(token.slice(1), 10);
      } else if (/^V\d+$/.test(token)) {
        const idx = parseInt(token.slice(1), 10);
        result.qualityTag =
          NekoBtStreamParser.VIDEO_QUALITY_MAP[idx] ?? undefined;
      } else if (/^C\d+$/.test(token)) {
        const idx = parseInt(token.slice(1), 10);
        result.codecTag = NekoBtStreamParser.VIDEO_CODEC_MAP[idx] ?? undefined;
      } else if (/^[AFS]=/.test(token)) {
        // language tags like A=en or F=en,jp
        const kind = token[0];
        const langs =
          token
            .slice(2)
            ?.split(',')
            .map((l) => l.trim())
            .filter(Boolean) ?? [];
        if (kind === 'A') {
          result.audioLanguages = (result.audioLanguages || []).concat(langs);
        } else if (kind === 'F') {
          result.fansubLanguages = (result.fansubLanguages || []).concat(langs);
        } else if (kind === 'S') {
          result.subtitleLanguages = (result.subtitleLanguages || []).concat(
            langs
          );
        }
      } else if (token === 'MTL' || token === 'OTL' || token === 'HS') {
        result[token] = true;
      }
    }

    return result;
  }

  protected getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    if (!parsedStream.filename && !parsedStream.folderName) {
      return undefined;
    }
    const addBackAutoTitleTags =
      this.addon.preset.options.leaveAutoTitleTagsInFilename ?? false;
    let titleTag = '';

    const filenameTags = this.extractTagsFromString(
      parsedStream.filename ?? ''
    );
    if (parsedStream.filename && Object.keys(filenameTags).length > 0) {
      const titleTagMatch = parsedStream.filename.match(
        NekoBtStreamParser.TAGS_REGEX
      );
      if (titleTagMatch) {
        titleTag = titleTagMatch[0];
        parsedStream.filename = parsedStream.filename
          .replace(NekoBtStreamParser.TAGS_REGEX, '')
          .trim();
      }
    }

    const folderTags = this.extractTagsFromString(
      parsedStream.folderName ?? ''
    );
    if (parsedStream.folderName && Object.keys(folderTags).length > 0) {
      const titleTagMatch = parsedStream.folderName.match(
        NekoBtStreamParser.TAGS_REGEX
      );
      if (titleTagMatch) {
        titleTag = titleTagMatch[0];
        parsedStream.folderName = parsedStream.folderName
          .replace(NekoBtStreamParser.TAGS_REGEX, '')
          .trim();
      }
    }

    const fileMetadata: Record<string, any> | undefined =
      Object.keys(filenameTags).length > 0
        ? filenameTags
        : Object.keys(folderTags).length > 0
          ? folderTags
          : undefined;

    const parsedFile = super.getParsedFile(stream, parsedStream);

    if (parsedFile && fileMetadata) {
      // codecTag
      if (fileMetadata.codecTag && typeof fileMetadata.codecTag === 'object') {
        const aioCodec = fileMetadata.codecTag.aiostreamsName;
        if (aioCodec && !parsedFile.encode) {
          parsedFile.encode = aioCodec;
        }
      }
      // qualityTag
      if (
        fileMetadata.qualityTag &&
        typeof fileMetadata.qualityTag === 'object'
      ) {
        const aioQuality = fileMetadata.qualityTag.aiostreamsName;
        if (aioQuality && !parsedFile.quality) {
          parsedFile.quality = aioQuality;
        }
      }
      // audio languages
      [...(fileMetadata.audioLanguages ?? [])]
        .map(NekoBtStreamParser.normalizeNekoBtLangCode)
        .map(mapLanguageCode)
        .map(convertLangCodeToName)
        .forEach((lang: string | undefined) => {
          if (lang && !parsedFile.languages?.includes(lang)) {
            parsedFile.languages = parsedFile.languages || [];
            parsedFile.languages.push(lang);
          }
        });

      // subtitle languages (includes fansubs)
      [
        ...(fileMetadata.fansubLanguages ?? []),
        ...(fileMetadata.subtitleLanguages ?? []),
      ]
        .map(NekoBtStreamParser.normalizeNekoBtLangCode)
        .map(mapLanguageCode)
        .map(convertLangCodeToName)
        .forEach((lang: string | undefined) => {
          if (lang && !parsedFile.subtitles?.includes(lang)) {
            parsedFile.subtitles = parsedFile.subtitles || [];
            parsedFile.subtitles.push(lang);
          }
        });
    }

    // add back after parsing so it is not interfering with filename parsing.
    if (addBackAutoTitleTags && titleTag) {
      parsedStream.filename =
        `${parsedStream.filename ?? ''} ${titleTag}`.trim();
    }

    return parsedFile;
  }
}

export class NekoBtPreset extends TorznabPreset {
  static override getParser(): typeof StreamParser {
    return NekoBtStreamParser;
  }
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'nekoBT',
        supportedResources,
        Env.BUILTIN_DEFAULT_NEKOBT_TIMEOUT || Env.DEFAULT_TIMEOUT
      ).filter((option) => option.id !== 'url' && option.id !== 'resources'),
      {
        id: 'apiKey',
        name: 'API Key (Optional)',
        description:
          'nekoBT API Key. You can find this in your nekoBT account settings.',
        type: 'password',
        required: false,
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: StremThruPreset.supportedServices.map((service) => ({
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
        default: [],
        options: [
          {
            label: 'Movie',
            value: 'movie',
          },
          {
            label: 'Series',
            value: 'series',
          },
          {
            label: 'Anime',
            value: 'anime',
          },
        ],
      },
      {
        id: 'searchMode',
        name: 'Search Mode',
        description:
          'The search mode to use when querying the nekoBT endpoint. **Note**: `Both` will result in two addons being created, one for each search mode.',
        type: 'select',
        required: false,
        showInSimpleMode: false,
        default: 'both',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Forced Query', value: 'query' },
          { label: 'Both', value: 'both' },
        ],
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'nekoBT supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'leaveAutoTitleTagsInFilename',
        name: 'Leave Auto Title Tags in Filename',
        description:
          'By default, [nekoBT auto title tags](https://wiki.nekobt.to/info/metadata/#auto-titles) (e.g. {Tags: ...}) are stripped from the filename after taking what we can. Enabling this option will leave them in. This may be useful if you want to use info that is not parsed (e.g. Sub level, MTL/OTL/HS tags) via regex.',
        type: 'boolean',
        default: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'website',
            url: Env.BUILTIN_NEKOBT_URL.replace('/api/torznab', ''),
          },
        ],
      },
    ];

    return {
      ID: 'neko-bt',
      NAME: 'nekoBT',
      LOGO: 'https://avatars.githubusercontent.com/u/221218851?v=4',
      URL: Env.BUILTIN_NEKOBT_URL,
      TIMEOUT: Env.BUILTIN_DEFAULT_NEKOBT_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION: 'An addon to get debrid results from nekoBT.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, any>
  ): string {
    const nekoBtUrl = this.METADATA.URL;

    const config = {
      ...this.getBaseConfig(userData, services),
      url: nekoBtUrl,
      apiKey: options.apiKey,
      apiPath: '/api',
      paginate: false,
      forceQuerySearch: options.forceQuerySearch ?? false,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');
    return `${Env.INTERNAL_URL}/builtins/torznab/${configString}/manifest.json`;
  }
}
