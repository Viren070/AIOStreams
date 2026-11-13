const RELEASES = 'https://github.com/Viren070/AIOStreams/releases';

export const releaseUrl = (tag: string) => `${RELEASES}/tag/${tag}`;
const asset = (tag: string, name: string) =>
  `${RELEASES}/download/${tag}/${name}`;

export type Platform =
  | 'windows'
  | 'mac'
  | 'linux'
  | 'android'
  | 'android-tv'
  | 'lg'
  | 'samsung'
  | 'browser'
  | 'apple';

export type Category = 'computer' | 'mobile' | 'tv' | 'web';

export interface DownloadFile {
  label: string;
  /** Who it's for. */
  detail?: string;
  href: string;
  /** The Downloader app's code for this file. */
  code?: string;
}

export interface DownloadOption {
  platform: Platform;
  name: string;
  category: Category;
  /** Which app's release it comes from. */
  app?: 'desktop' | 'android' | 'smart-tv';
  requirement: string;
  files: DownloadFile[];
  notes: string[];
  caveat?: string;
  guide: { label: string; href: string };
  beta?: boolean;
}

export const CATEGORIES: Array<{ id: Category; name: string }> = [
  { id: 'computer', name: 'Computers' },
  { id: 'mobile', name: 'Phones and tablets' },
  { id: 'tv', name: 'TVs' },
  { id: 'web', name: 'Anywhere else' },
];

const desktop = (name: string) => asset('desktop', name);
const android = (name: string) => asset('android', name);
const smartTv = (name: string) => asset('smart-tv', name);

export const DOWNLOADS: DownloadOption[] = [
  {
    platform: 'windows',
    name: 'Windows',
    category: 'computer',
    app: 'desktop',
    requirement: 'Windows 10 or 11',
    files: [
      {
        label: 'Installer',
        detail: 'Most PCs',
        href: desktop('aiostreams-desktop-win-x64.exe'),
      },
      {
        label: 'Arm installer',
        detail: 'Snapdragon and other Arm PCs',
        href: desktop('aiostreams-desktop-win-arm64.exe'),
      },
      {
        label: 'Portable',
        detail: 'No install',
        href: desktop('aiostreams-desktop-win-x64.zip'),
      },
      {
        label: 'Arm portable',
        href: desktop('aiostreams-desktop-win-arm64.zip'),
      },
    ],
    notes: [
      'Arm builds are for Snapdragon and other Arm PCs. The portable copy keeps everything in a folder beside it.',
    ],
    guide: { label: 'Desktop app', href: '/apps/desktop' },
  },
  {
    platform: 'mac',
    name: 'macOS',
    category: 'computer',
    app: 'desktop',
    requirement: 'macOS 11 or later',
    files: [
      {
        label: 'Apple silicon',
        detail: 'M1 or later',
        href: desktop('aiostreams-desktop-osx-arm64.pkg'),
      },
      {
        label: 'Intel',
        detail: 'Intel Macs',
        href: desktop('aiostreams-desktop-osx-x64.pkg'),
      },
      {
        label: 'Apple silicon .zip',
        href: desktop('aiostreams-desktop-osx-arm64.zip'),
      },
      {
        label: 'Intel .zip',
        href: desktop('aiostreams-desktop-osx-x64.zip'),
      },
    ],
    notes: [
      'Not signed by Apple yet: the first time, press Open Anyway in System Settings → Privacy & Security.',
    ],
    guide: { label: 'Desktop app', href: '/apps/desktop' },
  },
  {
    platform: 'linux',
    name: 'Linux',
    category: 'computer',
    app: 'desktop',
    requirement: 'Any distribution with Flatpak',
    files: [
      {
        label: 'Flatpak',
        detail: 'Most PCs',
        href: desktop('aiostreams-desktop-linux-x64.flatpak'),
      },
      {
        label: 'Arm Flatpak',
        href: desktop('aiostreams-desktop-linux-arm64.flatpak'),
      },
    ],
    notes: [
      'Open it in your software centre, or run flatpak install --user with the file name.',
    ],
    guide: { label: 'Desktop app', href: '/apps/desktop' },
  },
  {
    platform: 'android',
    name: 'Android',
    category: 'mobile',
    app: 'android',
    requirement: 'Android 7.0 or later, WebView 109 or later',
    files: [
      {
        label: 'arm64-v8a',
        detail: 'Most phones and tablets',
        href: android('aiostreams-android-arm64-v8a.apk'),
        code: '2899297',
      },
      {
        label: 'armeabi-v7a',
        detail: 'Older phones',
        href: android('aiostreams-android-armeabi-v7a.apk'),
        code: '5368982',
      },
      {
        label: 'x86_64',
        detail: 'Emulators',
        href: android('aiostreams-android-x86_64.apk'),
        code: '5765264',
      },
    ],
    notes: [
      'Not sure? Take arm64-v8a. Each has a code for the Downloader app.',
    ],
    guide: { label: 'Android app', href: '/apps/android' },
  },
  {
    platform: 'apple',
    name: 'iPhone and iPad',
    category: 'mobile',
    requirement: 'In Safari, or a Jellyfin app such as Infuse or Swiftfin',
    files: [],
    notes: [
      'Every configuration is also a media server, so Jellyfin apps sign in to it.',
    ],
    guide: { label: 'Jellyfin apps', href: '/apps/jellyfin' },
  },
  {
    platform: 'android-tv',
    name: 'Android TV and Fire TV',
    category: 'tv',
    app: 'android',
    requirement: 'Google TV, Fire TV and the NVIDIA Shield too',
    files: [
      {
        label: 'armeabi-v7a',
        detail: 'Fire TV sticks and most TV boxes',
        href: android('aiostreams-android-armeabi-v7a.apk'),
        code: '5368982',
      },
      {
        label: 'arm64-v8a',
        detail: 'NVIDIA Shield',
        href: android('aiostreams-android-arm64-v8a.apk'),
        code: '2899297',
      },
    ],
    notes: [
      'armeabi-v7a for Fire TV sticks and most TV boxes, arm64-v8a for the NVIDIA Shield.',
      'Type its code into the Downloader app to install without a computer.',
    ],
    caveat: 'May not run smoothly on some older or low-end TVs and sticks.',
    guide: { label: 'Installing on a TV', href: '/apps/android#on-a-tv' },
  },
  {
    platform: 'lg',
    name: 'LG TVs',
    category: 'tv',
    app: 'smart-tv',
    beta: true,
    requirement: 'webOS, with Developer Mode or the Homebrew Channel',
    files: [{ label: 'Download .ipk', href: smartTv('aiostreams-webos.ipk') }],
    notes: [
      'Installed with webOS Dev Manager, or from the Homebrew Channel, which keeps it updated.',
    ],
    caveat: 'May not run smoothly on some older or low-end TVs.',
    guide: { label: 'Install steps', href: '/apps/smart-tv#lg-tvs' },
  },
  {
    platform: 'samsung',
    name: 'Samsung TVs',
    category: 'tv',
    app: 'smart-tv',
    beta: true,
    requirement: 'Tizen, signed for your TV as it installs',
    files: [{ label: 'Download .wgt', href: smartTv('aiostreams-tizen.wgt') }],
    notes: ['Installed with Apps2Samsung or Tizen Studio.'],
    caveat: 'May not run smoothly on some older or low-end TVs.',
    guide: { label: 'Install steps', href: '/apps/smart-tv#samsung-tvs' },
  },
  {
    platform: 'browser',
    name: 'Any browser',
    category: 'web',
    requirement: 'Nothing to install',
    files: [],
    notes: [
      'Press Open in browser under Save & Install → AIOStreams app, or open web.aiostreams.org. Its WebGPU engine plays HEVC, Dolby Vision and surround sound.',
    ],
    guide: { label: 'Using a browser', href: '/apps#in-a-browser' },
  },
];

export const NIGHTLY = [
  { name: 'Desktop app', href: releaseUrl('desktop-nightly') },
  { name: 'Android app', href: releaseUrl('android-nightly') },
];

export const ALL_RELEASES = RELEASES;
