// import { AUDIO_TAGS, QUALITIES, RESOLUTIONS } from '../utils/constants';
// import { VISUAL_TAGS } from '../utils/constants';
// import { ENCODES } from '../utils/constants';
// import { LANGUAGES } from '../utils/constants';
// import { AUDIO_CHANNELS } from '../utils/constants';
// import { FakeVisualTag } from '../utils/constants';
import { constants } from '../utils/index.js';
const createRegex = (pattern: string): RegExp =>
  new RegExp(`(?<![^\\s\\[(_\\-.,])(${pattern})(?=[\\s\\)\\]_.\\-,]|$)`, 'i');

const createLanguageRegex = (pattern: string): RegExp =>
  createRegex(`${pattern}(?![ .\\-_]?sub(title)?s?)`);

type PARSE_REGEX = {
  resolutions: Omit<
    Record<(typeof constants.RESOLUTIONS)[number], RegExp>,
    'Unknown'
  >;
  qualities: Omit<
    Record<(typeof constants.QUALITIES)[number], RegExp>,
    'Unknown'
  >;
  visualTags: Omit<
    Record<(typeof constants.VISUAL_TAGS)[number], RegExp>,
    'Unknown' | constants.FakeVisualTag
  >;
  audioTags: Omit<
    Record<(typeof constants.AUDIO_TAGS)[number], RegExp>,
    'Unknown'
  >;
  audioChannels: Omit<
    Record<(typeof constants.AUDIO_CHANNELS)[number], RegExp>,
    'Unknown'
  >;
  languages: Omit<
    Record<(typeof constants.LANGUAGES)[number], RegExp>,
    'Unknown'
  >;
  encodes: Omit<Record<(typeof constants.ENCODES)[number], RegExp>, 'Unknown'>;
  releaseGroup: RegExp;
};

export const PARSE_REGEX: PARSE_REGEX = {
  resolutions: {
    '2160p': createRegex(
      '(bd|hd|m)?(4k|2160(p|i)?)|u(ltra)?[ .\\-_]?hd|3840\s?x\s?(\d{4})'
    ),
    '1440p': createRegex(
      '(bd|hd|m)?(1440(p|i)?)|2k|w?q(uad)?[ .\\-_]?hd|2560\s?x(\d{4})'
    ),
    '1080p': createRegex(
      '(bd|hd|m)?(1080(p|i)?)|f(ull)?[ .\\-_]?hd|1920\s?x\s?(\d{3,4})'
    ),
    '720p': createRegex('(bd|hd|m)?((720|800)(p|i)?)|hd|1280\s?x\s?(\d{3,4})'),
    '576p': createRegex('(bd|hd|m)?((576|534)(p|i)?)'),
    '480p': createRegex('(bd|hd|m)?(480(p|i)?)|sd'),
    '360p': createRegex('(bd|hd|m)?(360(p|i)?)'),
    '240p': createRegex('(bd|hd|m)?((240|266)(p|i)?)'),
    '144p': createRegex('(bd|hd|m)?(144(p|i)?)'),
  },
  qualities: {
    'BluRay REMUX':
      /(remux.*blu[\s.\-_]?ray|blu[\s.\-_]?ray.*remux|(bd|br|b|uhd)[\s.\-_]?remux)/i,
    BluRay: createRegex(
      'blu[ .\\-_]?ray|((bd|br|b)[ .\\-_]?(rip|r)?)(?![ .\\-_]?remux)'
    ),
    'WEB-DL': createRegex('web[ .\\-_]?(dl)?(?![ .\\-_]?(DLRip|cam))'),
    WEBRip: createRegex('web[ .\\-_]?rip'),
    HDRip: createRegex('hd[ .\\-_]?rip|web[ .\\-_]?dl[ .\\-_]?rip'),
    'HC HD-Rip': createRegex('hc|hd[ .\\-_]?rip'),
    DVDRip: createRegex('dvd[ .\\-_]?(rip|mux|r|full|5|9)?'),
    HDTV: createRegex(
      '(hd|pd)tv|tv[ .\\-_]?rip|hdtv[ .\\-_]?rip|dsr(ip)?|sat[ .\\-_]?rip'
    ),
    CAM: createRegex('cam|hdcam|cam[ .\\-_]?rip'),
    TS: createRegex('telesync|ts|hd[ .\\-_]?ts|pdvd|predvd(rip)?'),
    TC: createRegex('telecine|tc|hd[ .\\-_]?tc'),
    SCR: createRegex('((dvd|bd|web|hd)?[ .\\-_]?)?(scr(eener)?)'),
  },
  visualTags: {
    '10bit': createRegex('10[ .\\-_]?bit'),
    'HDR10+': createRegex('hdr[ .\\-_]?10[ .\\-_]?(p(lus)?|[+])'),
    HDR10: createRegex('hdr[ .\\-_]?10(?![ .\\-_]?(?:\\+|p(lus)?))'),
    HDR: createRegex('hdr(?![ .\\-_]?10)(?![ .\\-_]?(?:\\+|p(lus)?))'),
    DV: createRegex('do?(lby)?[ .\\-_]?vi?(sion)?(?:[ .\\-_]?atmos)?|dv'),
    '3D': createRegex('(bd)?(3|three)[ .\\-_]?(d(imension)?(al)?)'),
    IMAX: createRegex('imax'),
    AI: createRegex('ai[ .\\-_]?(upscale|enhanced|remaster)?'),
    SDR: createRegex('sdr'),
  },
  audioTags: {
    Atmos: createRegex('atmos'),
    'DD+': createRegex(
      '(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)(?:[ .\\-_]?(5[ .\\-_]?1|7[ .\\-_]?1))?)|e[ .\\-_]?ac[ .\\-_]?3'
    ),
    DD: createRegex(
      '(d(olby)?[ .\\-_]?d(igital)?(?:[ .\\-_]?(5[ .\\-_]?1|7[ .\\-_]?1|2[ .\\-_]?0?))?)|(?<!e[ .\\-_]?)ac[ .\\-_]?3'
    ),
    'DTS-HD MA': createRegex('dts[ .\\-_]?hd[ .\\-_]?ma'),
    'DTS-HD': createRegex('dts[ .\\-_]?hd(?![ .\\-_]?ma)'),
    'DTS-ES': createRegex('dts[ .\\-_]?es'),
    DTS: createRegex('dts(?![ .\\-_]?hd[ .\\-_]?ma|[ .\\-_]?hd|[ .\\-_]?es)'),
    TrueHD: createRegex('true[ .\\-_]?hd'),
    OPUS: createRegex('opus'),
    AAC: createRegex('q?aac(?:[ .\\-_]?2)?'),
    FLAC: createRegex('flac(?:[ .\\-_]?(lossless|2\\.0|x[2-4]))?'),
  },
  audioChannels: {
    '2.0': createRegex('(d(olby)?[ .\\-_]?d(igital)?)?2[ .\\-_]?0(ch)?'),
    '5.1': createRegex(
      '(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)?)?5[ .\\-_]?1(ch)?'
    ),
    '6.1': createRegex(
      '(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)?)?6[ .\\-_]?1(ch)?'
    ),
    '7.1': createRegex(
      '(d(olby)?[ .\\-_]?d(igital)?[ .\\-_]?(p(lus)?|\\+)?)?7[ .\\-_]?1(ch)?'
    ),
  },
  encodes: {
    HEVC: createRegex('hevc[ .\\-_]?(10)?|[xh][ .\\-_]?265'),
    AVC: createRegex('avc|[xh][ .\\-_]?264'),
    AV1: createRegex('av1'),
    XviD: createRegex('xvid'),
    DivX: createRegex('divx|dvix'),
    'H-OU': createRegex('h?(alf)?[ .\\-_]?(ou|over[ .\\-_]?under)'),
    'H-SBS': createRegex('h?(alf)?[ .\\-_]?(sbs|side[ .\\-_]?by[ .\\-_]?side)'),
  },
  languages: {
    Multi: createLanguageRegex('multi'),
    'Dual Audio': createLanguageRegex(
      'dual[ .\\-_]?(audio|lang(uage)?|flac|ac3|aac2?)'
    ),
    Dubbed: createLanguageRegex('dub(bed)?'),
    English: createLanguageRegex('english|eng'),
    Japanese: createLanguageRegex('japanese|jap|jpn'),
    Chinese: createLanguageRegex('chinese|chi'),
    Russian: createLanguageRegex('russian|rus'),
    Arabic: createLanguageRegex('arabic|ara'),
    Portuguese: createLanguageRegex('portuguese|por'),
    Spanish: createLanguageRegex('spanish|spa|esp'),
    French: createLanguageRegex('french|fra|fr|vf|vff|vfi|vf2|vfq|truefrench'),
    German: createLanguageRegex('deu(tsch)?(land)?|ger(man)?'),
    Italian: createLanguageRegex('italian|ita'),
    Korean: createLanguageRegex('korean|kor'),
    Hindi: createLanguageRegex('hindi|hin'),
    Bengali: createLanguageRegex('bengali|ben(?![ .\\-_]?the[ .\\-_]?men)'),
    Punjabi: createLanguageRegex('punjabi|pan'),
    Marathi: createLanguageRegex('marathi|mar'),
    Gujarati: createLanguageRegex('gujarati|guj'),
    Tamil: createLanguageRegex('tamil|tam'),
    Telugu: createLanguageRegex('telugu|tel'),
    Kannada: createLanguageRegex('kannada|kan'),
    Malayalam: createLanguageRegex('malayalam|mal'),
    Thai: createLanguageRegex('thai|tha'),
    Vietnamese: createLanguageRegex('vietnamese|vie'),
    Indonesian: createLanguageRegex('indonesian|ind'),
    Turkish: createLanguageRegex('turkish|tur'),
    Hebrew: createLanguageRegex('hebrew|heb'),
    Persian: createLanguageRegex('persian|per'),
    Ukrainian: createLanguageRegex('ukrainian|ukr'),
    Greek: createLanguageRegex('greek|ell'),
    Lithuanian: createLanguageRegex('lithuanian|lit'),
    Latvian: createLanguageRegex('latvian|lav'),
    Estonian: createLanguageRegex('estonian|est'),
    Polish: createLanguageRegex('polish|pol'),
    Czech: createLanguageRegex('czech|cze'),
    Slovak: createLanguageRegex('slovak|slo'),
    Hungarian: createLanguageRegex('hungarian|hun'),
    Romanian: createLanguageRegex('romanian|rum'),
    Bulgarian: createLanguageRegex('bulgarian|bul'),
    Serbian: createLanguageRegex('serbian|srp'),
    Croatian: createLanguageRegex('croatian|hrv'),
    Slovenian: createLanguageRegex('slovenian|slv'),
    Dutch: createLanguageRegex('dutch|dut'),
    Danish: createLanguageRegex('danish|dan'),
    Finnish: createLanguageRegex('finnish|fin'),
    Swedish: createLanguageRegex('swedish|swe'),
    Norwegian: createLanguageRegex('norwegian|nor'),
    Malay: createLanguageRegex('malay'),
    Latino: createLanguageRegex('latino|lat'),
  },
  releaseGroup:
    /- ?(?!\d+$|S\d+|\d+x|ep?\d+|[^[]+]$)([^\-. []+[^\-. [)\]\d][^\-. [)\]]*)(?:\[[\w.-]+])?(?=\.\w{2,4}$|$)/i,
};
