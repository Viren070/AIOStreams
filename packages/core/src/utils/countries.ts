// Sources disagree on format: TMDB alpha-2, TVDB and Skyhook lowercase
// alpha-3, release names UK. Compare only via normaliseCountryCode.
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  ABW: 'AW',
  AFG: 'AF',
  AGO: 'AO',
  AIA: 'AI',
  ALA: 'AX',
  ALB: 'AL',
  AND: 'AD',
  ARE: 'AE',
  ARG: 'AR',
  ARM: 'AM',
  ASM: 'AS',
  ATA: 'AQ',
  ATF: 'TF',
  ATG: 'AG',
  AUS: 'AU',
  AUT: 'AT',
  AZE: 'AZ',
  BDI: 'BI',
  BEL: 'BE',
  BEN: 'BJ',
  BES: 'BQ',
  BFA: 'BF',
  BGD: 'BD',
  BGR: 'BG',
  BHR: 'BH',
  BHS: 'BS',
  BIH: 'BA',
  BLM: 'BL',
  BLR: 'BY',
  BLZ: 'BZ',
  BMU: 'BM',
  BOL: 'BO',
  BRA: 'BR',
  BRB: 'BB',
  BRN: 'BN',
  BTN: 'BT',
  BVT: 'BV',
  BWA: 'BW',
  CAF: 'CF',
  CAN: 'CA',
  CCK: 'CC',
  CHE: 'CH',
  CHL: 'CL',
  CHN: 'CN',
  CIV: 'CI',
  CMR: 'CM',
  COD: 'CD',
  COG: 'CG',
  COK: 'CK',
  COL: 'CO',
  COM: 'KM',
  CPV: 'CV',
  CRI: 'CR',
  CUB: 'CU',
  CUW: 'CW',
  CXR: 'CX',
  CYM: 'KY',
  CYP: 'CY',
  CZE: 'CZ',
  DEU: 'DE',
  DJI: 'DJ',
  DMA: 'DM',
  DNK: 'DK',
  DOM: 'DO',
  DZA: 'DZ',
  ECU: 'EC',
  EGY: 'EG',
  ERI: 'ER',
  ESH: 'EH',
  ESP: 'ES',
  EST: 'EE',
  ETH: 'ET',
  FIN: 'FI',
  FJI: 'FJ',
  FLK: 'FK',
  FRA: 'FR',
  FRO: 'FO',
  FSM: 'FM',
  GAB: 'GA',
  GBR: 'GB',
  GEO: 'GE',
  GGY: 'GG',
  GHA: 'GH',
  GIB: 'GI',
  GIN: 'GN',
  GLP: 'GP',
  GMB: 'GM',
  GNB: 'GW',
  GNQ: 'GQ',
  GRC: 'GR',
  GRD: 'GD',
  GRL: 'GL',
  GTM: 'GT',
  GUF: 'GF',
  GUM: 'GU',
  GUY: 'GY',
  HKG: 'HK',
  HMD: 'HM',
  HND: 'HN',
  HRV: 'HR',
  HTI: 'HT',
  HUN: 'HU',
  IDN: 'ID',
  IMN: 'IM',
  IND: 'IN',
  IOT: 'IO',
  IRL: 'IE',
  IRN: 'IR',
  IRQ: 'IQ',
  ISL: 'IS',
  ISR: 'IL',
  ITA: 'IT',
  JAM: 'JM',
  JEY: 'JE',
  JOR: 'JO',
  JPN: 'JP',
  KAZ: 'KZ',
  KEN: 'KE',
  KGZ: 'KG',
  KHM: 'KH',
  KIR: 'KI',
  KNA: 'KN',
  KOR: 'KR',
  KWT: 'KW',
  LAO: 'LA',
  LBN: 'LB',
  LBR: 'LR',
  LBY: 'LY',
  LCA: 'LC',
  LIE: 'LI',
  LKA: 'LK',
  LSO: 'LS',
  LTU: 'LT',
  LUX: 'LU',
  LVA: 'LV',
  MAC: 'MO',
  MAF: 'MF',
  MAR: 'MA',
  MCO: 'MC',
  MDA: 'MD',
  MDG: 'MG',
  MDV: 'MV',
  MEX: 'MX',
  MHL: 'MH',
  MKD: 'MK',
  MLI: 'ML',
  MLT: 'MT',
  MMR: 'MM',
  MNE: 'ME',
  MNG: 'MN',
  MNP: 'MP',
  MOZ: 'MZ',
  MRT: 'MR',
  MSR: 'MS',
  MTQ: 'MQ',
  MUS: 'MU',
  MWI: 'MW',
  MYS: 'MY',
  MYT: 'YT',
  NAM: 'NA',
  NCL: 'NC',
  NER: 'NE',
  NFK: 'NF',
  NGA: 'NG',
  NIC: 'NI',
  NIU: 'NU',
  NLD: 'NL',
  NOR: 'NO',
  NPL: 'NP',
  NRU: 'NR',
  NZL: 'NZ',
  OMN: 'OM',
  PAK: 'PK',
  PAN: 'PA',
  PCN: 'PN',
  PER: 'PE',
  PHL: 'PH',
  PLW: 'PW',
  PNG: 'PG',
  POL: 'PL',
  PRI: 'PR',
  PRK: 'KP',
  PRT: 'PT',
  PRY: 'PY',
  PSE: 'PS',
  PYF: 'PF',
  QAT: 'QA',
  REU: 'RE',
  ROU: 'RO',
  RUS: 'RU',
  RWA: 'RW',
  SAU: 'SA',
  SDN: 'SD',
  SEN: 'SN',
  SGP: 'SG',
  SGS: 'GS',
  SHN: 'SH',
  SJM: 'SJ',
  SLB: 'SB',
  SLE: 'SL',
  SLV: 'SV',
  SMR: 'SM',
  SOM: 'SO',
  SPM: 'PM',
  SRB: 'RS',
  SSD: 'SS',
  STP: 'ST',
  SUR: 'SR',
  SVK: 'SK',
  SVN: 'SI',
  SWE: 'SE',
  SWZ: 'SZ',
  SXM: 'SX',
  SYC: 'SC',
  SYR: 'SY',
  TCA: 'TC',
  TCD: 'TD',
  TGO: 'TG',
  THA: 'TH',
  TJK: 'TJ',
  TKL: 'TK',
  TKM: 'TM',
  TLS: 'TL',
  TON: 'TO',
  TTO: 'TT',
  TUN: 'TN',
  TUR: 'TR',
  TUV: 'TV',
  TWN: 'TW',
  TZA: 'TZ',
  UGA: 'UG',
  UKR: 'UA',
  UMI: 'UM',
  URY: 'UY',
  USA: 'US',
  UZB: 'UZ',
  VAT: 'VA',
  VCT: 'VC',
  VEN: 'VE',
  VGB: 'VG',
  VIR: 'VI',
  VNM: 'VN',
  VUT: 'VU',
  WLF: 'WF',
  WSM: 'WS',
  YEM: 'YE',
  ZAF: 'ZA',
  ZMB: 'ZM',
  ZWE: 'ZW',
};

/**
 * Accepts alpha-2, alpha-3 or the scene's UK tag, returns uppercase alpha-2.
 * Every `country` field in the codebase holds this form.
 */
export function normaliseCountryCode(code?: string | null): string | undefined {
  if (!code) return undefined;
  const upper = code.trim().toUpperCase();
  if (upper.length === 2) return upper === 'UK' ? 'GB' : upper;
  if (upper.length === 3) return ALPHA3_TO_ALPHA2[upper];
  return undefined;
}

// Names Intl doesn't give that sources send: TMDB's, and TVmaze's ISO ones.
const OTHER_NAMES: Record<string, string> = {
  'United States of America': 'US',
  'Czech Republic': 'CZ',
  Turkey: 'TR',
  Macedonia: 'MK',
  Swaziland: 'SZ',
  'Holy See': 'VA',
  'Korea, Republic of': 'KR',
  "Korea, Democratic People's Republic of": 'KP',
  'Russian Federation': 'RU',
  'Viet Nam': 'VN',
  'Iran, Islamic Republic of': 'IR',
  'Taiwan, Province of China': 'TW',
  'Syrian Arab Republic': 'SY',
  "Lao People's Democratic Republic": 'LA',
  'Bolivia, Plurinational State of': 'BO',
  'Venezuela, Bolivarian Republic of': 'VE',
  'Tanzania, United Republic of': 'TZ',
  'Moldova, Republic of': 'MD',
  'Palestine, State of': 'PS',
  'Palestinian Territory': 'PS',
  'Congo, The Democratic Republic of the': 'CD',
};

// Rather than Intl's "Hong Kong SAR China" or "Myanmar (Burma)".
const SHORT_NAMES = new Set(['HK', 'MO', 'MM', 'PS']);

// Letters only, so "Cote D'Ivoire" finds "Côte d’Ivoire".
const nameKey = (name: string) =>
  name
    .normalize('NFD')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z]/g, '');

let names:
  { byCode: Map<string, string>; byKey: Map<string, string> } | undefined;

function countryNames() {
  if (names) return names;
  const long = new Intl.DisplayNames(['en'], { type: 'region' });
  const short = new Intl.DisplayNames(['en'], {
    type: 'region',
    style: 'short',
  });
  const byCode = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const code of Object.values(ALPHA3_TO_ALPHA2)) {
    const full = long.of(code)!;
    const brief = short.of(code)!;
    byCode.set(code, SHORT_NAMES.has(code) ? brief : full);
    byKey.set(nameKey(full), code).set(nameKey(brief), code);
  }
  for (const [name, code] of Object.entries(OTHER_NAMES))
    byKey.set(nameKey(name), code);
  return (names = { byCode, byKey });
}

/** One English name for a country, from its code or any source's name for it. */
export function countryName(country: string): string | undefined {
  const { byCode, byKey } = countryNames();
  const code = normaliseCountryCode(country) ?? byKey.get(nameKey(country));
  return code ? byCode.get(code) : undefined;
}

/** Only the tags release groups actually use to disambiguate same-name shows. */
export function countryToReleaseTag(alpha2?: string): string | undefined {
  switch (alpha2) {
    case 'GB':
      return 'UK';
    case 'US':
    case 'AU':
    case 'NZ':
    case 'CA':
      return alpha2;
    default:
      return undefined;
  }
}
