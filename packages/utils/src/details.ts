import { AddonDetail } from '@scrapie/types';
import { Settings } from './settings';

export const addonDetails: AddonDetail[] = [
  {
    name: 'Torrentio',
    id: 'torrentio',
    requiresService: false,
    supportedServices: [
      'realdebrid',
      'alldebrid',
      'premiumize',
      'debridlink',
      'torbox',
      'offcloud',
      'putio',
    ],
    options: [
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          'Override the name of the Torrentio addon that shows up in the results',
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the torrentio addon. This option is incompatible with the useMultipleInstances option. By default, the URL is generated based on the selected services and their credentials. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'useMultipleInstances',
        required: false,
        label: 'Use Multiple Instances',
        description:
          "Torrentio supports multiple services. By default, Scrapie will pass all services to Torrentio. However, Torrentio has its\
          own service priority system which can't be overriden. If you want to use a custom priority system for your services, you can enable this option.\
          to create a separate request for each service.",
        type: 'checkbox',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Torrentio addon. This is the time in milliseconds that the addon will wait for a response before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Comet',
    id: 'comet',
    requiresService: true,
    supportedServices: [
      'realdebrid',
      'alldebrid',
      'premiumize',
      'debridlink',
      'torbox',
    ],
    options: [
      {
        id: 'prioritiseDebrid',
        required: false,
        label: 'Prioritise Debrid Service',
        description:
          'Prioritise a specific debrid service when fetching streams. This option is useful when you want to use a specific debrid service for fetching streams. By default, the addon will make a separate request for each debrid service. I highly recommend provding a value for this option as it will speed up the fetching process and remove redundant results.',
        type: 'select',
        options: [
          { value: 'realdebrid', label: 'Real Debrid' },
          { value: 'alldebrid', label: 'All Debrid' },
          { value: 'premiumize', label: 'Premiumize' },
          { value: 'debridlink', label: 'Debrid Link' },
          { value: 'torbox', label: 'Torbox' },
        ],
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          'Override the name of the Comet addon that shows up in the results',
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the Comet addon. This option is incompatible with the prioritiseDebrid option. By default, the URL is generated based on the selected services and their credentials. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Comet addon. This is the time in milliseconds that the addon will wait for a response before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'MediaFusion',
    id: 'mediafusion',
    requiresService: false,
    supportedServices: [
      'realdebrid',
      'alldebrid',
      'premiumize',
      'debridlink',
      'torbox',
      'offcloud',
      'easydebrid',
      'pikpak',
      'seedr',
    ],
    options: [
      {
        id: 'prioritiseDebrid',
        required: false,
        label: 'Prioritise Debrid Service',
        description:
          'Prioritise a specific debrid service when fetching streams. This option is useful when you want to use a specific debrid service for fetching streams. By default, the addon will make a separate request for each debrid service. I highly recommend provding a value for this option as it will speed up the fetching process and remove redundant results.',
        type: 'select',
        options: [
          { value: 'realdebrid', label: 'Real Debrid' },
          { value: 'alldebrid', label: 'All Debrid' },
          { value: 'premiumize', label: 'Premiumize' },
          { value: 'debridlink', label: 'Debrid Link' },
          { value: 'torbox', label: 'Torbox' },
          { value: 'offcloud', label: 'Offcloud' },
          { value: 'easydebrid', label: 'EasyDebrid' },
        ],
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          'Override the name of the Media Fusion addon that shows up in the results',
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the Media Fusion addon. This option is incompatible with the prioritiseDebrid option. By default, the URL is generated based on the selected services and their credentials. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Media Fusion addon. This is the time in milliseconds that the addon will wait for a response before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
      {
        id: 'filterCertificationLevels',
        required: false,
        label: 'Filter Certification Levels',
        description:
          'Choose levels of certification to filter out. By default, all filters are disabled',
        type: 'multiSelect',
        options: [
          { value: 'Unknown', label: 'Unknown' },
          { value: 'All Ages', label: 'All Ages' },
          { value: 'Children', label: 'Children' },
          { value: 'Parental Guidance', label: 'Parental Guidance' },
          { value: 'Teens', label: 'Teens' },
          { value: 'Adults', label: 'Adults' },
        ],
      },
      {
        id: 'filterNudity',
        required: false,
        label: 'Filter Nudity',
        description:
          'Choose levels of nudity to filter out. By default, all filters are disabled',
        type: 'multiSelect',
        options: [
          { value: 'Unknown', label: 'Unknown' },
          { value: 'None', label: 'None' },
          { value: 'Mild', label: 'Mild' },
          { value: 'Moderate', label: 'Moderate' },
          { value: 'Severe', label: 'Severe' },
        ],
      },
    ],
  },
  {
    name: 'Jackettio',
    id: 'jackettio',
    requiresService: true,
    supportedServices: ['realdebrid', 'alldebrid', 'premiumize', 'debridlink'],
    options: [
      {
        id: 'prioritiseDebrid',
        required: false,
        label: 'Prioritise Debrid Service',
        description:
          'Prioritise a specific debrid service when fetching streams. This option is useful when you want to use a specific debrid service for fetching streams. By default, the addon will make a separate request for each debrid service. I highly recommend provding a value for this option as it will speed up the fetching process and remove redundant results.',
        type: 'select',
        options: [
          { value: 'realdebrid', label: 'Real Debrid' },
          { value: 'alldebrid', label: 'All Debrid' },
          { value: 'premiumize', label: 'Premiumize' },
          { value: 'debridlink', label: 'Debrid Link' },
        ],
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          'Override the name of the Jackettio addon that shows up in the results',
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the Jackettio addon. This option is incompatible with the prioritiseDebrid option. By default, the URL is generated based on the selected services and their credentials. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Jackettio addon. This is the time in milliseconds that the addon will wait for a response before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Torbox',
    id: 'torbox',
    requiresService: true,
    supportedServices: ['torbox'],
    options: [
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Torbox addon. This is the time in milliseconds that the addon will wait for a response from Torbox before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          "Override the name of the addon that shows up in the results. Leave it empty to use the default name of 'Torbox'.",
        type: 'text',
      },
    ],
  },
  {
    name: 'Easynews',
    id: 'easynews',
    requiresService: true,
    supportedServices: ['easynews'],
    options: [
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          "Override the name of the addon that shows up in the results. Leave it empty to use the default name of 'Easynews'.",
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the Easynews addon. By default, the URL is generated based on the username and password provided for the Easynews service. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Easynews addon in milliseconds. This is the time in milliseconds that the addon will wait for a response from Easynews before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Easynews+',
    id: 'easynews-plus',
    requiresService: true,
    supportedServices: ['easynews'],
    options: [
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          "Override the name of the addon that shows up in the results. Leave it empty to use the default name of 'Easynews Plus'.",
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the Easynews Plus addon. By default, the URL is generated based on the username and password provided for the Easynews service. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Easynews Plus addon in milliseconds. This is the time in milliseconds that the addon will wait for a response from Easynews Plus before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Debridio',
    id: 'debridio',
    requiresService: true,
    supportedServices: ['easydebrid'],
    options: [
      {
        id: 'prioritiseDebrid',
        required: false,
        label: 'Prioritise Debrid Service',
        description:
          'Prioritise a specific debrid service when fetching streams. This option is useful when you want to use a specific debrid service for fetching streams. By default, the addon will make a separate request for each debrid service. I highly recommend provding a value for this option as it will speed up the fetching process and remove redundant results.',
        type: 'select',
        options: [{ value: 'easydebrid', label: 'EasyDebrid' }],
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          "Override the name of the addon that shows up in the results. Leave it empty to use the default name of 'Debridio'.",
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the Debridio addon. By default, the URL is generated based on the username and password provided for the Debridio service. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Debridio addon in milliseconds. This is the time in milliseconds that the addon will wait for a response from Debridio before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Orion Stremio Addon',
    id: 'orion-stremio-addon',
    requiresService: false,
    supportedServices: [
      'realdebrid',
      'alldebrid',
      'premiumize',
      'debridlink',
      'offcloud',
    ],
    options: [
      {
        id: 'orionApiKey',
        label: 'Orion API Key',
        type: 'deprecated',
        secret: true,
      },
      {
        id: 'showTorrents',
        required: false,
        label: 'Show Torrents',
        description:
          'If you have not provided any debrid services, this option does not apply to you, it will show torrent streams regardless.\
          Show torrents along with debrid streams. By default, the addon will only show debrid streams. Enable this option to show torrents as well.',
        type: 'checkbox',
      },
      {
        id: 'linkLimit',
        required: false,
        label: 'Link Limit',
        description:
          'The maximum number of links to fetch from the Orion addon. Leave it empty to use the default limit.',
        type: 'number',
        constraints: {
          min: 1,
          max: 50,
        },
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          "Override the name of the addon that shows up in the results. Leave it empty to use the default name of 'Orion'.",
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the Orion addon. By default, the URL is generated based on the selected services and their credentials. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Orion addon in milliseconds. This is the time in milliseconds that the addon will wait for a response from Orion before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Peerflix',
    id: 'peerflix',
    requiresService: false,
    supportedServices: [
      'realdebrid',
      'alldebrid',
      'torbox',
      'debridlink',
      'offcloud',
      'putio',
      'premiumize',
    ],
    options: [
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          'Override the name of the Peerflix addon that shows up in the results',
        type: 'text',
      },
      {
        id: 'overrideUrl',
        secret: true,
        required: false,
        label: 'Override URL',
        description:
          'Override the URL used to fetch streams from the peerflix addon. This option is incompatible with the useMultipleInstances option. By default, the URL is generated based on the selected services and their credentials. Use this option to override the URL with a custom URL.',
        type: 'text',
      },
      {
        id: 'useMultipleInstances',
        required: false,
        label: 'Use Multiple Instances',
        description:
          'Peerflix supports multiple debrid services. By default, Scrapie will pass all services to Peerflix in one request.\
          If you would like to override this behaviour and make a separate request for each service, enable this option.\
          I do not recommend enabling this option.',
        type: 'checkbox',
      },
      {
        id: 'showP2PStreams',
        required: false,
        label: 'Show P2P Streams',
        description:
          'If you have not provided any debrid services, this option does not apply to you. This option is for those who are using Peerflix with debrid services. By default, Peerflix will only show streams from debrid services. If you would like to show P2P streams as well, enable this option.\
          Enabling this option will show P2P (torrent) streams for the torrents that were uncached on the debrid services',
        type: 'checkbox',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Peerflix addon. This is the time in milliseconds that the addon will wait for a response before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'DMM Cast',
    id: 'dmm-cast',
    requiresService: false,
    supportedServices: [],
    options: [
      {
        id: 'installationUrl',
        required: true,
        label: 'Installation URL',
        description:
          'The installation URL for the DMM cast addon specific to your account. You can find this at https://debridmediamanager.com/stremio',
        type: 'text',
        secret: true,
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          "Override the name of the addon that shows up in the results. Leave it empty to use the default name of 'DMM Cast'.",
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the DMM Cast addon in milliseconds. This is the time in milliseconds that the addon will wait for a response from DMM Cast before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Stremio GDrive',
    id: 'gdrive',
    requiresService: false,
    supportedServices: [],
    options: [
      {
        id: 'addonUrl',
        secret: true,
        required: true,
        label: 'Addon URL',
        description:
          'The URL to the manifest.json file for your Google Drive addon. This would be the URL of your Cloudflare Worker which looks something like https://your-worker-name.your-subdomain.workers.dev/manifest.json',
        type: 'text',
      },
      {
        id: 'overrideName',
        required: false,
        label: 'Override Addon Name',
        description:
          "Override the name of the addon that shows up in the results. Leave it empty to use the default name of 'GDrive'.",
        type: 'text',
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the Google Drive addon in milliseconds. This is the time in milliseconds that the addon will wait for a response from your Cloudflare Worker before timing out. Leave it empty to use the recommended timeout.',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
  {
    name: 'Custom',
    id: 'custom',
    requiresService: false,
    supportedServices: [],
    options: [
      {
        id: 'name',
        required: true,
        description:
          'The name of the custom addon. This is the name that will show up in the results',
        label: 'Name',
        type: 'text',
      },
      {
        id: 'url',
        required: true,
        description:
          'The URL of the custom addon. This is the URL that will be used to fetch streams from the custom addon. The URL should point to the manifest.json file of the custom addon',
        label: 'URL',
        type: 'text',
        secret: true,
      },
      {
        id: 'indexerTimeout',
        required: false,
        label: 'Override Indexer Timeout',
        description:
          'The timeout for fetching streams from the custom addon in milliseconds',
        type: 'number',
        constraints: {
          min: Settings.MIN_TIMEOUT,
          max: Settings.MAX_TIMEOUT,
        },
      },
    ],
  },
];

export const serviceDetails = [
  {
    name: 'Real Debrid',
    shortName: 'RD',
    knownNames: ['RD', 'Real Debrid', 'RealDebrid', 'Real-Debrid'],
    id: 'realdebrid',
    signUpLink: 'https://real-debrid.com/?id=9483829',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://real-debrid.com/apitoken',
      },
    ],
  },
  {
    name: 'All Debrid',
    id: 'alldebrid',
    shortName: 'AD',
    knownNames: ['AD', 'All Debrid', 'AllDebrid', 'All-Debrid'],
    signUpLink: 'https://alldebrid.com/?uid=3n8qa&lang=en',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://alldebrid.com/apikeys',
      },
    ],
  },
  {
    name: 'Premiumize',
    id: 'premiumize',
    shortName: 'PM',
    knownNames: ['PM', 'Premiumize'],
    signUpLink: 'https://www.premiumize.me/register',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://www.premiumize.me/account',
      },
    ],
  },
  {
    name: 'Debrid Link',
    id: 'debridlink',
    shortName: 'DL',
    knownNames: ['DL', 'Debrid Link', 'DebridLink', 'Debrid-Link'],
    signUpLink: 'https://debrid-link.com/id/EY0JO',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://debrid-link.com/webapp/apikey',
      },
    ],
  },
  {
    name: 'Torbox',
    id: 'torbox',
    shortName: 'TB',
    knownNames: ['TB', 'TRB', 'Torbox'],
    signUpLink:
      'https://torbox.app/subscription?referral=9ca21adb-dbcb-4fb0-9195-412a5f3519bc',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://torbox.app/settings',
      },
    ],
  },
  {
    name: 'Offcloud',
    id: 'offcloud',
    shortName: 'OC',
    knownNames: ['OC', 'Offcloud'],
    signUpLink: 'https://offcloud.com/?=06202a3d',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://offcloud.com/#/account',
      },
    ],
  },
  {
    name: 'put.io',
    id: 'putio',
    shortName: 'P.IO',
    knownNames: ['PO', 'put.io', 'putio'],
    signUpLink: 'https://put.io/',
    credentials: [
      {
        label: 'Client ID',
        id: 'clientId',
        link: 'https://put.io/oauth',
      },
      {
        label: 'Token',
        id: 'token',
        link: 'https://put.io/oauth',
      },
    ],
  },
  {
    name: 'Easynews',
    id: 'easynews',
    shortName: 'EN',
    knownNames: ['EN', 'Easynews'],
    signUpLink: 'https://www.easynews.com/',
    credentials: [
      {
        label: 'Username',
        id: 'username',
        link: 'https://www.easynews.com/',
      },
      {
        label: 'Password',
        id: 'password',
        link: 'https://www.easynews.com/',
      },
    ],
  },
  {
    name: 'EasyDebrid',
    id: 'easydebrid',
    shortName: 'ED',
    knownNames: ['ED', 'EasyDebrid'],
    signUpLink: 'https://paradise-cloud.com/products/easydebrid',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://paradise-cloud.com/products/easydebrid',
      },
    ],
  },
  {
    name: 'PikPak',
    id: 'pikpak',
    shortName: 'PKP',
    knownNames: ['PP', 'PikPak', 'PKP'],
    signUpLink:
      'https://mypikpak.com/drive/activity/invited?invitation-code=72822731',
    credentials: [
      {
        label: 'Email',
        id: 'email',
      },
      {
        label: 'Password',
        id: 'password',
      },
    ],
  },
  {
    name: 'Seedr',
    id: 'seedr',
    shortName: 'SDR',
    knownNames: ['SR', 'Seedr', 'SDR'],
    signUpLink: 'https://www.seedr.cc/?r=6542079',
    credentials: [
      {
        label:
          'Encoded Token. Please authorise at MediaFusion and copy the token into here.',
        id: 'apiKey',
      },
    ],
  },
  {
    name: 'Orion',
    id: 'orion',
    shortName: 'OR',
    knownNames: ['dontmatchme'],
    signUpLink:
      'https://orionoid.com/referral/AD3JGNJRJFMRDNP9SEKHQKS9MGSAJDJN',
    credentials: [
      {
        label: 'API Key',
        id: 'apiKey',
        link: 'https://panel.orionoid.com/',
      },
    ],
  },
];
