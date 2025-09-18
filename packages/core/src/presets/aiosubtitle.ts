import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, RESOURCES, SUBTITLES_RESOURCE } from '../utils/index.js';

export class AIOSubtitlePreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];

    const languages = [
      { label: 'Abkhaz (\u0410\u04a7\u0441\u0443\u0430)', value: 'abkhaz' },
      { label: 'Afar (Afaraf)', value: 'afar' },
      { label: 'Afrikaans', value: 'afrikaans' },
      { label: 'Akan', value: 'akan' },
      { label: 'Albanian (Shqip)', value: 'albanian' },
      { label: 'Amharic (\u12a0\u121b\u122d\u129b)', value: 'amharic' },
      {
        label: 'Arabic (\u0627\u0644\u0639\u0631\u0628\u064a\u0629)',
        value: 'arabic',
      },
      { label: 'Aragonese (Aragon\u00e9s)', value: 'aragonese' },
      {
        label: 'Armenian (\u0540\u0561\u0575\u0565\u0580\u0565\u0576)',
        value: 'armenian',
      },
      {
        label: 'Assamese (\u0985\u09b8\u09ae\u09c0\u09af\u09bc\u09be)',
        value: 'assamese',
      },
      { label: 'Avaric (\u0410\u0432\u0430\u0440)', value: 'avaric' },
      { label: 'Avestan (avesta)', value: 'avestan' },
      { label: 'Aymara (Aymar)', value: 'aymara' },
      { label: 'Azerbaijani (Az\u0259rbaycanca)', value: 'azerbaijani' },
      { label: 'Bambara (Bamanankan)', value: 'bambara' },
      {
        label:
          'Bashkir (\u0411\u0430\u0448\u04a1\u043e\u0440\u0442\u0441\u0430)',
        value: 'bashkir',
      },
      { label: 'Basque (Euskara)', value: 'basque' },
      {
        label:
          'Belarusian (\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u044f)',
        value: 'belarusian',
      },
      { label: 'Bengali (\u09ac\u09be\u0982\u09b2\u09be)', value: 'bengali' },
      {
        label: 'Bihari (\u092d\u094b\u091c\u092a\u0941\u0930\u0940)',
        value: 'bihari',
      },
      { label: 'Bislama', value: 'bislama' },
      { label: 'Bosnian (Bosanski)', value: 'bosnian' },
      { label: 'Breton (Brezhoneg)', value: 'breton' },
      {
        label:
          'Bulgarian (\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438)',
        value: 'bulgarian',
      },
      {
        label:
          'Burmese (\u1019\u103c\u1014\u103a\u1019\u102c\u1018\u102c\u101e\u102c)',
        value: 'burmese',
      },
      { label: 'Catalan (Catal\u00e0)', value: 'catalan' },
      { label: 'Chamorro (Chamoru)', value: 'chamorro' },
      {
        label: 'Chechen (\u041d\u043e\u0445\u0447\u0438\u0439\u043d)',
        value: 'chechen',
      },
      { label: 'Chichewa', value: 'chichewa' },
      { label: 'Chinese (\u4e2d\u6587)', value: 'chinese' },
      {
        label: 'Chuvash (\u0427\u04d1\u0432\u0430\u0448\u043b\u0430)',
        value: 'chuvash',
      },
      { label: 'Cornish (Kernewek)', value: 'cornish' },
      { label: 'Corsican (Corsu)', value: 'corsican' },
      {
        label: 'Cree (\u14c0\u1426\u1403\u152d\u140d\u140f\u1423)',
        value: 'cree',
      },
      { label: 'Croatian (Hrvatski)', value: 'croatian' },
      { label: 'Czech (\u010ce\u0161tina)', value: 'czech' },
      { label: 'Danish (Dansk)', value: 'danish' },
      { label: 'Divehi', value: 'divehi' },
      { label: 'Dutch (Nederlands)', value: 'dutch' },
      {
        label: 'Dzongkha (\u0f62\u0fab\u0f7c\u0f44\u0f0b\u0f41)',
        value: 'dzongkha',
      },
      { label: 'English', value: 'english' },
      { label: 'Esperanto', value: 'esperanto' },
      { label: 'Estonian (Eesti)', value: 'estonian' },
      { label: 'Ewe (E\u028begbe)', value: 'ewe' },
      { label: 'Faroese (F\u00f8royskt)', value: 'faroese' },
      { label: 'Fijian (Na Vosa Vaka-Viti)', value: 'fijian' },
      { label: 'Finnish (Suomi)', value: 'finnish' },
      { label: 'French (Fran\u00e7ais)', value: 'french' },
      { label: 'Fula (Fulfulde)', value: 'fula' },
      { label: 'Galician (Galego)', value: 'galician' },
      {
        label: 'Georgian (\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8)',
        value: 'georgian',
      },
      { label: 'German (Deutsch)', value: 'german' },
      {
        label: 'Greek (\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac)',
        value: 'greek',
      },
      { label: "Guaran\u00ed (Ava\u00f1e'\u1ebd)", value: 'guaran\u00ed' },
      {
        label: 'Gujarati (\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0)',
        value: 'gujarati',
      },
      { label: 'Haitian (Krey\u00f2l Ayisyen)', value: 'haitian' },
      { label: 'Hausa (\u0647\u064e\u0648\u064f\u0633\u064e)', value: 'hausa' },
      { label: 'Hebrew (\u05e2\u05d1\u05e8\u05d9\u05ea)', value: 'hebrew' },
      { label: 'Herero (Otjiherero)', value: 'herero' },
      { label: 'Hindi (\u0939\u093f\u0928\u094d\u0926\u0940)', value: 'hindi' },
      { label: 'Hiri Motu', value: 'hiri motu' },
      { label: 'Hungarian (Magyar)', value: 'hungarian' },
      { label: 'Interlingua', value: 'interlingua' },
      { label: 'Indonesian (Bahasa Indonesia)', value: 'indonesian' },
      { label: 'Interlingue', value: 'interlingue' },
      { label: 'Irish (Gaeilge)', value: 'irish' },
      { label: 'Igbo', value: 'igbo' },
      { label: 'Inupiaq (I\u00f1upiak)', value: 'inupiaq' },
      { label: 'Ido', value: 'ido' },
      { label: 'Icelandic (\u00cdslenska)', value: 'icelandic' },
      { label: 'Italian (Italiano)', value: 'italian' },
      {
        label: 'Inuktitut (\u1403\u14c4\u1483\u144e\u1450\u1466)',
        value: 'inuktitut',
      },
      { label: 'Japanese (\u65e5\u672c\u8a9e)', value: 'japanese' },
      { label: 'Javanese (Basa Jawa)', value: 'javanese' },
      { label: 'Kalaallisut', value: 'kalaallisut' },
      { label: 'Kannada (\u0c95\u0ca8\u0ccd\u0ca8\u0ca1)', value: 'kannada' },
      { label: 'Kanuri', value: 'kanuri' },
      {
        label: 'Kashmiri (\u0643\u0634\u0645\u064a\u0631\u064a)',
        value: 'kashmiri',
      },
      {
        label: 'Kazakh (\u049a\u0430\u0437\u0430\u049b\u0448\u0430)',
        value: 'kazakh',
      },
      {
        label: 'Khmer (\u1797\u17b6\u179f\u17b6\u1781\u17d2\u1798\u17c2\u179a)',
        value: 'khmer',
      },
      { label: 'Kikuyu (G\u0129k\u0169y\u0169)', value: 'kikuyu' },
      { label: 'Kinyarwanda', value: 'kinyarwanda' },
      {
        label: 'Kyrgyz (\u041a\u044b\u0440\u0433\u044b\u0437\u0447\u0430)',
        value: 'kyrgyz',
      },
      { label: 'Komi (\u041a\u043e\u043c\u0438)', value: 'komi' },
      { label: 'Kongo', value: 'kongo' },
      { label: 'Korean (\ud55c\uad6d\uc5b4)', value: 'korean' },
      { label: 'Kurdish (Kurd\u00ee)', value: 'kurdish' },
      { label: 'Kwanyama (Kuanyama)', value: 'kwanyama' },
      { label: 'Latin (Latina)', value: 'latin' },
      { label: 'Luxembourgish (L\u00ebtzebuergesch)', value: 'luxembourgish' },
      { label: 'Ganda (Luganda)', value: 'ganda' },
      { label: 'Limburgish (Limburgs)', value: 'limburgish' },
      { label: 'Lingala (Ling\u00e1la)', value: 'lingala' },
      {
        label: 'Lao (\u0e9e\u0eb2\u0eaa\u0eb2\u0ea5\u0eb2\u0ea7)',
        value: 'lao',
      },
      { label: 'Lithuanian (Lietuvi\u0173)', value: 'lithuanian' },
      { label: 'Luba-Katanga (Tshiluba)', value: 'luba-katanga' },
      { label: 'Latvian (Latvie\u0161u)', value: 'latvian' },
      { label: 'Manx (Gaelg)', value: 'manx' },
      {
        label:
          'Macedonian (\u041c\u0430\u043a\u0435\u0434\u043e\u043d\u0441\u043a\u0438)',
        value: 'macedonian',
      },
      { label: 'Malagasy', value: 'malagasy' },
      { label: 'Malay (Bahasa Melayu)', value: 'malay' },
      {
        label: 'Malayalam (\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02)',
        value: 'malayalam',
      },
      { label: 'Maltese (Malti)', value: 'maltese' },
      { label: 'M\u0101ori', value: 'm\u0101ori' },
      { label: 'Marathi (\u092e\u0930\u093e\u0920\u0940)', value: 'marathi' },
      { label: 'Marshallese (Kajin M\u0327aje\u013c)', value: 'marshallese' },
      {
        label: 'Mongolian (\u041c\u043e\u043d\u0433\u043e\u043b)',
        value: 'mongolian',
      },
      { label: 'Nauru (Dorerin Naoero)', value: 'nauru' },
      { label: 'Navajo (Din\u00e9 Bizaad)', value: 'navajo' },
      { label: 'Northern Ndebele (isiNdebele)', value: 'northern ndebele' },
      {
        label: 'Nepali (\u0928\u0947\u092a\u093e\u0932\u0940)',
        value: 'nepali',
      },
      { label: 'Ndonga (Owambo)', value: 'ndonga' },
      {
        label: 'Norwegian Bokm\u00e5l (Norsk (Bokm\u00e5l))',
        value: 'norwegian bokm\u00e5l',
      },
      {
        label: 'Norwegian Nynorsk (Norsk (Nynorsk))',
        value: 'norwegian nynorsk',
      },
      { label: 'Norwegian (Norsk)', value: 'norwegian' },
      { label: 'Nuosu (\ua188\ua320\ua4bf Nuosuhxop)', value: 'nuosu' },
      { label: 'Southern Ndebele (isiNdebele)', value: 'southern ndebele' },
      { label: 'Occitan', value: 'occitan' },
      {
        label: 'Ojibwe (\u140a\u14c2\u1511\u14c8\u142f\u14a7\u140e\u14d0)',
        value: 'ojibwe',
      },
      {
        label:
          'Old Church Slavonic (\u0421\u043b\u043e\u0432\u0463\u0301\u043d\u044c\u0441\u043a\u044a)',
        value: 'old church slavonic',
      },
      { label: 'Oromo (Afaan Oromoo)', value: 'oromo' },
      { label: 'Oriya (\u0b13\u0b21\u0b3f\u0b3c\u0b06)', value: 'oriya' },
      {
        label:
          'Ossetian (\u0418\u0440\u043e\u043d \u00e6\u0432\u0437\u0430\u0433)',
        value: 'ossetian',
      },
      {
        label: 'Panjabi (\u0a2a\u0a70\u0a1c\u0a3e\u0a2c\u0a40)',
        value: 'panjabi',
      },
      { label: 'P\u0101li (\u092a\u093e\u0934\u093f)', value: 'p\u0101li' },
      { label: 'Persian (\u0641\u0627\u0631\u0633\u06cc)', value: 'persian' },
      { label: 'Polish (Polski)', value: 'polish' },
      { label: 'Pashto (\u067e\u069a\u062a\u0648)', value: 'pashto' },
      { label: 'Portuguese (Portugu\u00eas)', value: 'portuguese' },
      { label: 'Quechua (Runa Simi)', value: 'quechua' },
      { label: 'Romansh (Rumantsch)', value: 'romansh' },
      { label: 'Kirundi', value: 'kirundi' },
      { label: 'Romanian (Rom\u00e2n\u0103)', value: 'romanian' },
      {
        label: 'Russian (\u0420\u0443\u0441\u0441\u043a\u0438\u0439)',
        value: 'russian',
      },
      {
        label:
          'Sanskrit (\u0938\u0902\u0938\u094d\u0915\u0943\u0924\u092e\u094d)',
        value: 'sanskrit',
      },
      { label: 'Sardinian (Sardu)', value: 'sardinian' },
      { label: 'Sindhi (\u0633\u0646\u068c\u064a\u200e)', value: 'sindhi' },
      { label: 'Northern Sami (S\u00e1megiella)', value: 'northern sami' },
      { label: 'Samoan (Gagana S\u0101moa)', value: 'samoan' },
      { label: 'Sango (S\u00e4ng\u00f6)', value: 'sango' },
      {
        label: 'Serbian (\u0421\u0440\u043f\u0441\u043a\u0438)',
        value: 'serbian',
      },
      { label: 'Gaelic (G\u00e0idhlig)', value: 'gaelic' },
      { label: 'Shona (ChiShona)', value: 'shona' },
      { label: 'Sinhala (\u0dc3\u0dd2\u0d82\u0dc4\u0dbd)', value: 'sinhala' },
      { label: 'Slovak (Sloven\u010dina)', value: 'slovak' },
      { label: 'Slovene (Sloven\u0161\u010dina)', value: 'slovene' },
      { label: 'Somali (Soomaaliga)', value: 'somali' },
      { label: 'Southern Sotho (Sesotho)', value: 'southern sotho' },
      { label: 'Spanish (Espa\u00f1ol)', value: 'spanish' },
      { label: 'Sundanese (Basa Sunda)', value: 'sundanese' },
      { label: 'Swahili (Kiswahili)', value: 'swahili' },
      { label: 'Swati (SiSwati)', value: 'swati' },
      { label: 'Swedish (Svenska)', value: 'swedish' },
      { label: 'Tamil (\u0ba4\u0bae\u0bbf\u0bb4\u0bcd)', value: 'tamil' },
      {
        label: 'Telugu (\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41)',
        value: 'telugu',
      },
      { label: 'Tajik (\u0422\u043e\u04b7\u0438\u043a\u04e3)', value: 'tajik' },
      {
        label: 'Thai (\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22)',
        value: 'thai',
      },
      { label: 'Tigrinya (\u1275\u130d\u122d\u129b)', value: 'tigrinya' },
      {
        label: 'Tibetan Standard (\u0f56\u0f7c\u0f51\u0f0b\u0f61\u0f72\u0f42)',
        value: 'tibetan standard',
      },
      { label: 'Turkmen (T\u00fcrkmen\u00e7e)', value: 'turkmen' },
      { label: 'Tagalog', value: 'tagalog' },
      { label: 'Tswana (Setswana)', value: 'tswana' },
      { label: 'Tonga (faka Tonga)', value: 'tonga' },
      { label: 'Turkish (T\u00fcrk\u00e7e)', value: 'turkish' },
      { label: 'Tsonga (Xitsonga)', value: 'tsonga' },
      {
        label: 'Tatar (\u0422\u0430\u0442\u0430\u0440\u0447\u0430)',
        value: 'tatar',
      },
      { label: 'Twi', value: 'twi' },
      { label: 'Tahitian (Reo M\u0101\u2019ohi)', value: 'tahitian' },
      {
        label: 'Uyghur (\u0626\u06c7\u064a\u063a\u06c7\u0631\u0686\u0647)',
        value: 'uyghur',
      },
      {
        label:
          'Ukrainian (\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430)',
        value: 'ukrainian',
      },
      { label: 'Urdu (\u0627\u0631\u062f\u0648)', value: 'urdu' },
      { label: 'Uzbek (O\u2018zbek)', value: 'uzbek' },
      { label: 'Venda (Tshiven\u1e13a)', value: 'venda' },
      { label: 'Vietnamese (Ti\u1ebfng Vi\u1ec7t)', value: 'vietnamese' },
      { label: 'Volap\u00fck', value: 'volap\u00fck' },
      { label: 'Walloon (Walon)', value: 'walloon' },
      { label: 'Welsh (Cymraeg)', value: 'welsh' },
      { label: 'Wolof', value: 'wolof' },
      { label: 'Western Frisian (Frysk)', value: 'western frisian' },
      { label: 'Xhosa (isiXhosa)', value: 'xhosa' },
      {
        label: 'Yiddish (\u05d9\u05d9\u05b4\u05d3\u05d9\u05e9)',
        value: 'yiddish',
      },
      { label: 'Yoruba (Yor\u00f9b\u00e1)', value: 'yoruba' },
      { label: 'Zhuang (Cuengh)', value: 'zhuang' },
      { label: 'Zulu (isiZulu)', value: 'zulu' },
    ];

    const options: Option[] = [
      ...baseOptions(
        'AIOSubtitle',
        supportedResources,
        Env.DEFAULT_AIOSUBTITLE_TIMEOUT || Env.DEFAULT_TIMEOUT
      ),
      {
        id: 'languages',
        type: 'multi-select',
        name: 'Languages',
        description: 'Select the languages you want subtitles in',
        options: languages,
        required: true,
        constraints: {
          min: 1,
        },
      },
      {
        id: 'microsoftTranslatorApiKey',
        type: 'string',
        name: 'Microsoft Translator API Key (Optional)',
        description:
          'If you want to use Microsoft Translator to translate subtitles, enter your API key here.\n[How to get an API key](https://www.google.com/search?q=how+to+register+microsoft+translator+and+get+api+key&oq=how+to+register+microsoft+translator+and+get+api+key)',
        required: false,
      },
      {
        id: 'microsoftTranslatorRegion',
        type: 'string',
        name: 'Microsoft Translator Region (Optional)',
        description:
          "The region of your Microsoft Translator API key. If you don't know, leave it as global.",
        required: false,
        default: 'global',
      },
      {
        id: 'socials',
        type: 'socials',
        name: '',
        description: '',
        socials: [
          {
            id: 'donate',
            url: 'https://coindrop.to/liamng',
          },
        ],
      },
    ];

    return {
      ID: 'aiosubtitle',
      NAME: 'AIO Subtitle',
      LOGO: `${Env.AIOSUBTITLE_URL}/assets/AI-sub.png`,
      URL: Env.AIOSUBTITLE_URL,
      TIMEOUT: Env.DEFAULT_AIOSUBTITLE_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_AIOSUBTITLE_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Unofficial addon to get subtitles from Subscene, OpenSubtitles, and Kitsunekko. Uses Microsoft Translator to translate subtitles.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(options),
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(options: Record<string, any>): string {
    if (options.url?.endsWith('/manifest.json')) {
      return options.url;
    }
    const host = options.url || this.METADATA.URL;

    let config: string[][] = [['languages', options.languages.join(',')]];
    if (options.microsoftTranslatorApiKey) {
      config.push(['transProvider', 'Microsoft']);
      config.push(['apiKey', options.microsoftTranslatorApiKey]);
      config.push(['location', options.microsoftTranslatorRegion]);
    }

    const configString = this.urlEncodeKeyValuePairs(config);

    return `${host}/stremio/${configString}/manifest.json`;
  }
}
