import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  FaRocket,
  FaBook,
  FaTv,
  FaFileCode,
  FaSlidersH,
  FaQuestionCircle,
  FaArrowRight,
  FaWindows,
  FaApple,
  FaLinux,
  FaAndroid,
  FaGlobe,
  FaDownload,
} from 'react-icons/fa';
import { SiJellyfin, SiStremio } from 'react-icons/si';
import {
  LuClapperboard,
  LuFilter,
  LuGlobe,
  LuHistory,
  LuHouse,
  LuLanguages,
  LuListMusic,
  LuPictureInPicture,
  LuPictureInPicture2,
  LuPuzzle,
  LuSettings2,
  LuServer,
  LuSkipForward,
  LuSmartphone,
  LuTv,
  LuTvMinimalPlay,
  LuUsers,
  LuWandSparkles,
} from 'react-icons/lu';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { CompareSlider } from '@/components/compare-slider';
import { DonateButton } from '@/components/donate-button';
import { StartWatching } from '@/components/start-watching';
import { appVersions } from '@/lib/app-versions';
import { getChangelogEntries } from '@/lib/source';
import { canonical, sharedOpenGraph } from '@/lib/site';
import { cn } from '@/lib/cn';

export const metadata: Metadata = {
  alternates: { canonical: canonical('/') },
  openGraph: { ...sharedOpenGraph, url: canonical('/') },
};

const PLATFORMS: Array<{ name: string; href: string; icon: IconType }> = [
  { name: 'Windows', href: '/download#windows', icon: FaWindows },
  { name: 'macOS', href: '/download#mac', icon: FaApple },
  { name: 'Linux', href: '/download#linux', icon: FaLinux },
  { name: 'Android', href: '/download#android', icon: FaAndroid },
  {
    name: 'Android TV & Fire TV',
    href: '/download#android-tv',
    icon: LuTvMinimalPlay,
  },
  { name: 'LG', href: '/download#lg', icon: LuTv },
  { name: 'Samsung', href: '/download#samsung', icon: LuTv },
  { name: 'Browser', href: '/download#browser', icon: FaGlobe },
];

type Media =
  | { kind: 'image'; src: string; alt: string; width: number; height: number }
  | { kind: 'video'; src: string; label: string; width: number; height: number }
  | {
      kind: 'grid';
      images: Array<{ src: string; alt: string }>;
      width: number;
      height: number;
    }
  | { kind: 'compare'; node: ReactNode };

interface Feature {
  id: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
  points?: string[];
  link?: { label: string; href: string };
  media: Media;
}

const FEATURES: Feature[] = [
  {
    id: 'browse',
    eyebrow: 'Browse',
    title: 'Your catalogs, as a streaming app',
    body: 'Every catalog you add becomes a row on Home, under a featured title you can play straight away. Each film, show and person gets a page of their own, with seasons, cast, trailers and what to watch next.',
    points: [
      'Continue Watching, Next Up and episodes airing soon',
      'Discover, search, favourites, collections and a calendar',
      'A user each for your household, with an optional PIN',
    ],
    link: { label: 'The AIOStreams app', href: '/apps' },
    media: {
      kind: 'image',
      src: '/showcase/phones.webp',
      alt: 'Three phones: the home page with a film featured, a show’s page with its ratings and actions, and its episodes',
      width: 2694,
      height: 1908,
    },
  },
  {
    id: 'live-tv',
    eyebrow: 'Live TV',
    title: 'Channels with a programme guide',
    body: 'Add an IPTV addon or your Xtream login and its channels appear as Live TV: grouped, numbered and searchable, with a guide of what’s on. The channel you picked keeps playing above the guide while you look for the next one.',
    points: [
      'Play earlier programmes where your provider keeps them',
      'Reminders for programmes later on',
      'Favourite channels on Home, and channel numbers on the remote',
    ],
    link: { label: 'Live TV in the app', href: '/apps/live-tv' },
    media: {
      kind: 'image',
      src: '/apps/live-tv/guide.webp',
      alt: 'Live TV’s programme guide, with a channel playing in a preview above the grid',
      width: 2160,
      height: 1350,
    },
  },
  {
    id: 'addons',
    eyebrow: 'Addons in charge',
    title: 'Run by the addons you choose',
    body: 'Catalogs, details, streams, subtitles and channels all come from addons, and so does your history. A tracker addon brings in what you’ve watched, your watchlist and your ratings, and gets back your progress, ratings and drops as you watch.',
    points: [
      'Continue Watching and watched marks from your tracker',
      'Ratings from every source a metadata addon sends',
      'Collections, people and similar titles from addons too',
    ],
    link: { label: 'What addons can send', href: '/reference/addon-protocol' },
    media: {
      kind: 'image',
      src: '/showcase/title.webp',
      alt: 'Severance’s page in the app, with Resume and the actions a tracker addon hears about: watched, favourite, drop and rate',
      width: 2160,
      height: 1350,
    },
  },
  {
    id: 'versions',
    eyebrow: 'Versions',
    title: 'Every stream, sorted your way',
    body: 'Press Play and the streams your addons found are versions of the title, filtered, sorted and named by the rules you set once, with the one your rules rank highest first.',
    points: [
      'Quick filters and badges, your own or a shared pack',
      'Switch version mid-play, or open one in another player',
    ],
    link: {
      label: 'Version filters and badges',
      href: '/reference/version-badges',
    },
    media: {
      kind: 'image',
      src: '/changelog/v2.37/versions.webp',
      alt: 'A film’s versions in a side sheet, with quick filter pills and badges on each version',
      width: 2288,
      height: 1430,
    },
  },
  {
    id: 'player',
    eyebrow: 'Playback',
    title: 'A player that just works',
    body: 'The desktop app plays with mpv, and the Android app with ExoPlayer or mpv, set up so you don’t have to touch a thing. Styled subtitles, such as most anime releases, are drawn by libass in every app, signs and all, in a browser and on TVs too.',
    points: [
      'Dolby Vision and HDR, with profile 7 converted where the device only takes profile 8',
      'Surround passed through format by format, or turned into Dolby Digital for optical and ARC',
      'The TV switched to each video’s frame rate',
      'Subtitles synced by themselves, dialogue boost, night mode and audio delay',
      'Seek previews, skipped intros and the next episode on its own',
    ],
    link: {
      label: 'Playing in the Android app',
      href: '/apps/android#playing',
    },
    media: {
      kind: 'image',
      src: '/apps/desktop/player.webp',
      alt: 'Sintel paused in the player, with a gold styled sign above a styled subtitle',
      width: 2288,
      height: 1430,
    },
  },
  {
    id: 'upscaling',
    eyebrow: 'Anime upscaling',
    title: 'Sharper anime, as it plays',
    body: 'Older and lower-resolution anime comes out with cleaner lines and less blocking, scaled up on your own device as it plays. It turns on by itself for titles your catalogs mark as anime, in the desktop and Android apps and in a browser’s WebGPU engine.',
    points: [
      'Press U in the player to compare',
      'Leaves HDR alone, and steps aside on a device that can’t keep up',
      'Or bring your own shaders and mpv.conf to mpv, and scripts in the desktop app',
    ],
    link: { label: 'Anime upscaling', href: '/apps#anime-upscaling' },
    media: {
      kind: 'compare',
      node: (
        <CompareSlider
          before={{
            src: '/showcase/upscaling-before.webp',
            alt: 'A 480p Naruto frame, scaled up the usual way',
            label: 'Usual scaling',
          }}
          after={{
            src: '/showcase/upscaling-after.webp',
            alt: 'The same frame scaled by the app’s anime upscaling, with cleaner, sharper lines',
            label: 'Anime upscaling',
          }}
          width={1440}
          height={1080}
        />
      ),
    },
  },
  {
    id: 'customise',
    eyebrow: 'Make it yours',
    title: 'As plain or as custom as you like',
    body: 'It looks good as it comes, and nearly everything can change: where the navigation sits and what it’s made of, how the featured title behaves, your colours, and which page it opens on. Every part of the app is labelled for custom CSS, so a theme can restyle anything.',
    points: [
      'Navigation along the top, down the side or in a corner, on solid, frosted or liquid glass',
      'Themes, and your own accent and background colours',
      'Hundreds of documented CSS hooks, with examples',
    ],
    link: { label: 'Themes and custom CSS', href: '/reference/web-app-css' },
    media: {
      kind: 'grid',
      images: [
        {
          src: '/apps/android/tv-style-rail-floating.webp',
          alt: 'A floating side rail on liquid glass',
        },
        {
          src: '/apps/android/tv-style-top-pills.webp',
          alt: 'Floating pills along the top on frosted glass',
        },
        {
          src: '/apps/android/tv-style-rail-corner.webp',
          alt: 'The navigation folded into a corner button',
        },
        {
          src: '/apps/android/tv-hero-corner.webp',
          alt: 'A featured title that follows the focused card from the corner',
        },
      ],
      width: 1920,
      height: 1080,
    },
  },
  {
    id: 'together',
    eyebrow: 'Together',
    title: 'Watch with friends, wherever they are',
    body: 'Start a watch party and everyone’s player stays in step: pause, seek and pick the next episode together, with chat and reactions on screen. Friends can join from another AIOStreams server too.',
    link: { label: 'Watch together', href: '/apps/watch-together' },
    media: {
      kind: 'image',
      src: '/changelog/v2.37/party-panel.webp',
      alt: 'A film playing in a watch party, with the party panel listing who is watching',
      width: 2288,
      height: 1430,
    },
  },
  {
    id: 'offline',
    eyebrow: 'Offline',
    title: 'Take it with you',
    body: 'Download films, episodes and whole seasons on your computer or Android phone to watch without a connection. Pages you’ve opened stay browsable offline too.',
    link: { label: 'Downloads and offline', href: '/apps/offline' },
    media: {
      kind: 'image',
      src: '/apps/offline/phones.webp',
      alt: 'Two phones: the Downloads page, and the home page browsing without a connection',
      width: 1840,
      height: 1806,
    },
  },
];

const MORE: Array<{
  icon: IconType;
  title: string;
  body: string;
  href: string;
}> = [
  {
    icon: LuSmartphone,
    title: 'Play on another device',
    body: 'Send a title to the TV and use your phone as its remote.',
    href: '/apps#playing',
  },
  {
    icon: LuPictureInPicture2,
    title: 'Mini player',
    body: 'Keep watching in a corner while you browse.',
    href: '/apps#playing',
  },
  {
    icon: LuPictureInPicture,
    title: 'Picture-in-picture',
    body: 'Keep watching in a small window over your other apps, in a browser, on Windows and on Android.',
    href: '/apps#playing',
  },
  {
    icon: LuClapperboard,
    title: 'Trailers on their own',
    body: 'Rest on a title and its trailer plays, in its card, the featured title or behind its page.',
    href: '/apps#what-it-has',
  },
  {
    icon: LuListMusic,
    title: 'Playlists',
    body: 'Line titles up, shuffle them, or repeat.',
    href: '/apps#playing',
  },
  {
    icon: LuSkipForward,
    title: 'Skips',
    body: 'Intros, credits, and filler and recap episodes where your metadata marks them.',
    href: '/apps/media-server#skipping-intros-and-credits',
  },
  {
    icon: LuUsers,
    title: 'Households',
    body: 'A user each, with their own history and an optional PIN.',
    href: '/apps/media-server#users-and-pins',
  },
  {
    icon: LuLanguages,
    title: 'In your language',
    body: 'Translated by the community on Weblate.',
    href: '/guides/translating',
  },
  {
    icon: LuSettings2,
    title: 'Your own mpv setup',
    body: 'Bring your mpv.conf, scripts and shaders to the built-in player.',
    href: '/apps/desktop#settings',
  },
  {
    icon: SiJellyfin,
    title: 'Jellyfin both ways',
    body: 'Infuse, Swiftfin and Kodi sign in to your configuration, and the app signs in to Jellyfin servers.',
    href: '/apps#jellyfin-servers',
  },
  {
    icon: LuGlobe,
    title: 'Nothing to install',
    body: 'Open the app at web.aiostreams.org and sign in to your configuration or any Jellyfin server.',
    href: 'https://web.aiostreams.org',
  },
  {
    icon: LuHistory,
    title: 'From Stremio or Nuvio',
    body: 'Watch Import brings your watch history, Continue Watching and library along.',
    href: 'https://watch-import.viren070.me',
  },
];

const ENGINE: Array<{ icon: IconType; title: string; body: string }> = [
  {
    icon: LuPuzzle,
    title: 'Sources',
    body: '80+ Stremio addons in a marketplace, or any by URL. Built-in torrent and Usenet indexers, and your debrid and Usenet services, entered once.',
  },
  {
    icon: LuFilter,
    title: 'Your rules',
    body: 'Filters, sorting, deduplication and expressions, then a formatter that names every stream the way you like.',
  },
  {
    icon: LuHouse,
    title: 'Wherever you watch',
    body: 'The AIOStreams app, Stremio as one addon, Jellyfin apps, Seanime and more, all from the same configuration.',
  },
];

const SECTIONS: Array<{
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    href: '/getting-started',
    title: 'Getting Started',
    description: 'Use a public instance or deploy your own in minutes.',
    icon: <FaRocket />,
  },
  {
    href: '/apps',
    title: 'Apps',
    description:
      'The AIOStreams app in a browser, on computers, phones and TVs, and in Jellyfin apps.',
    icon: <FaTv />,
  },
  {
    href: '/configuration/setup',
    title: 'Configuration',
    description:
      'Walk through setup, then every option and environment variable.',
    icon: <FaSlidersH />,
  },
  {
    href: '/guides/groups',
    title: 'Guides',
    description: 'Groups, usenet, scored sorting, SSO and config profiles.',
    icon: <FaBook />,
  },
  {
    href: '/reference/stream-expressions',
    title: 'Reference',
    description:
      'Stream and config expressions, the formatter, templates and the HTTP API.',
    icon: <FaFileCode />,
  },
  {
    href: '/faq',
    title: 'Help',
    description: 'Answers to common questions and fixes for common problems.',
    icon: <FaQuestionCircle />,
  },
];

const primaryButton =
  'inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-500/25 transition-colors hover:bg-brand-600';
const secondaryButton =
  'inline-flex items-center gap-2 rounded-full border border-fd-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-muted';

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'AIOStreams', url: canonical('/') },
    {
      '@type': 'SoftwareApplication',
      name: 'AIOStreams',
      url: canonical('/'),
      description:
        'Your Stremio addons, debrid services and Usenet in one list, filtered, sorted and formatted your way, in Stremio or the AIOStreams apps.',
      applicationCategory: 'MultimediaApplication',
      operatingSystem:
        'Windows, macOS, Linux, Android, Android TV, webOS, Tizen',
      downloadUrl: canonical('/download'),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      sameAs: ['https://github.com/Viren070/AIOStreams'],
    },
  ],
};

export default function HomePage() {
  const latest = getChangelogEntries()[0];

  return (
    <main className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <Hero latest={latest} />

      <section
        id="features"
        className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 sm:px-6"
      >
        {FEATURES.map((feature, i) => (
          <FeatureRow key={feature.id} feature={feature} flip={i % 2 === 1} />
        ))}
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight md:text-3xl">
          And plenty more
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MORE.map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="group rounded-2xl border border-fd-border bg-fd-card p-5 transition-colors hover:border-brand-500/40"
            >
              <item.icon className="mb-3 size-5 text-brand-600 dark:text-brand-400" />
              <h3 className="mb-1 font-semibold">{item.title}</h3>
              <p className="text-sm text-fd-muted-foreground">{item.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <Engine />
      <OwnInstance />
      <StartWatching versions={appVersions()} />

      <section className="mx-auto w-full max-w-4xl px-6 pb-16">
        <p className="mb-4 text-xs font-medium uppercase tracking-wider text-fd-muted-foreground">
          Explore the docs
        </p>
        <Cards className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((section) => (
            <Card
              key={section.href}
              {...section}
              className="@max-lg:col-span-1"
            />
          ))}
        </Cards>
      </section>
    </main>
  );
}

function Hero({
  latest,
}: {
  latest: ReturnType<typeof getChangelogEntries>[number] | undefined;
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(97_82_223/0.22),transparent)]"
      />
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 pb-12 pt-20 text-center sm:px-6">
        {latest && (
          <Link
            href={latest.url}
            className="group inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-muted/50 px-3 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-brand-500" />
            </span>
            New in v{latest.data.version ?? latest.slugs.at(-1)}
            <span className="text-fd-foreground">{latest.data.title}</span>
            <FaArrowRight
              size={9}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        )}
        <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
          AIOStreams
        </h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground md:text-xl">
          Your Stremio addons, debrid services and Usenet in one list, filtered,
          sorted and formatted your way. Watch in the AIOStreams app on your
          computer, phone and TV, or in Stremio.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/download" className={primaryButton}>
            <FaDownload className="size-3.5" />
            Download the app
          </Link>
          <Link href="/getting-started" className={secondaryButton}>
            Get started
          </Link>
          <DonateButton className={secondaryButton} />
        </div>
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-fd-muted-foreground">
          {PLATFORMS.map((platform) => (
            <li key={platform.name}>
              <Link
                href={platform.href}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-fd-foreground"
              >
                <platform.icon className="size-3.5" />
                {platform.name}
              </Link>
            </li>
          ))}
        </ul>
        <Image
          src="/apps/hero.webp"
          alt="The AIOStreams app on a TV, a computer and a phone"
          width={2940}
          height={2000}
          priority
          className="mt-6 h-auto w-full max-w-5xl"
        />
      </div>
    </section>
  );
}

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  return (
    <article
      id={feature.id}
      className="grid scroll-mt-20 items-center gap-8 border-t border-fd-border py-16 md:grid-cols-5 md:gap-12"
    >
      <div className={cn('md:col-span-2', flip && 'md:order-last')}>
        <p className="mb-2 text-sm font-medium text-brand-600 dark:text-brand-400">
          {feature.eyebrow}
        </p>
        <h2 className="mb-4 text-2xl font-semibold tracking-tight md:text-3xl">
          {feature.title}
        </h2>
        <p className="text-fd-muted-foreground">{feature.body}</p>
        {feature.points && (
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {feature.points.map((point) => (
              <li key={point} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" />
                {point}
              </li>
            ))}
          </ul>
        )}
        {feature.link && (
          <Link
            href={feature.link.href}
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            {feature.link.label}
            <FaArrowRight className="size-3" />
          </Link>
        )}
      </div>
      <div className="md:col-span-3">
        <FeatureMedia media={feature.media} />
      </div>
    </article>
  );
}

function FeatureMedia({ media }: { media: Media }) {
  if (media.kind === 'compare') return media.node;
  if (media.kind === 'grid')
    return (
      <div className="grid grid-cols-2 gap-3">
        {media.images.map((image) => (
          <Image
            key={image.src}
            src={image.src}
            alt={image.alt}
            width={media.width}
            height={media.height}
            loading="lazy"
            className="h-auto w-full rounded-lg border border-fd-border"
          />
        ))}
      </div>
    );
  if (media.kind === 'video')
    return (
      <video
        src={media.src}
        width={media.width}
        height={media.height}
        aria-label={media.label}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="h-auto w-full rounded-xl border border-fd-border"
      />
    );
  return (
    <Image
      src={media.src}
      alt={media.alt}
      width={media.width}
      height={media.height}
      loading="lazy"
      className="h-auto w-full rounded-xl border border-fd-border"
    />
  );
}

function Engine() {
  return (
    <section className="border-y border-fd-border bg-fd-card/40">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium text-brand-600 dark:text-brand-400">
            The engine
          </p>
          <h2 className="mb-4 text-2xl font-semibold tracking-tight md:text-3xl">
            One configuration for every source
          </h2>
          <p className="mb-8 text-fd-muted-foreground">
            Underneath the app is the addon AIOStreams started as. It asks every
            source you’ve added, removes the duplicates, and filters, sorts and
            names what comes back by your rules. Set them once and they apply
            everywhere you watch.
          </p>
          <ol className="flex flex-col gap-5">
            {ENGINE.map((step) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                  <step.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-sm text-fd-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/configuration/setup" className={secondaryButton}>
              Set it up
            </Link>
            <Link href="/getting-started" className={secondaryButton}>
              <SiStremio className="size-3.5" />
              Use it in Stremio
            </Link>
          </div>
        </div>
        <Image
          src="/showcase/formatter-preview.webp"
          alt="The formatter’s live preview, naming a stream from its release’s filename"
          width={2288}
          height={1208}
          loading="lazy"
          className="h-auto w-full rounded-xl border border-fd-border"
        />
      </div>
    </section>
  );
}

function OwnInstance() {
  const points: Array<{ icon: IconType; title: string; body: string }> = [
    {
      icon: LuServer,
      title: 'A built-in Usenet engine',
      body: 'Streams releases straight from your provider, archives included. First to the first byte in the public benchmark.',
    },
    {
      icon: LuWandSparkles,
      title: 'Sonarr, Radarr and a dashboard',
      body: 'A library that takes no disk space, live streams and bandwidth, logs, users and every runtime setting.',
    },
  ];
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 md:grid-cols-2">
      <Image
        src="/showcase/dashboard.webp"
        alt="The dashboard, with two streams through the built-in proxy"
        width={2288}
        height={1430}
        loading="lazy"
        className="h-auto w-full rounded-xl border border-fd-border md:order-first"
      />
      <div>
        <p className="mb-2 text-sm font-medium text-brand-600 dark:text-brand-400">
          Self-hosted
        </p>
        <h2 className="mb-4 text-2xl font-semibold tracking-tight md:text-3xl">
          More on your own instance
        </h2>
        <p className="mb-6 text-fd-muted-foreground">
          Everything above works on a public instance. Host AIOStreams yourself
          and you also get:
        </p>
        <ul className="flex flex-col gap-5">
          {points.map((point) => (
            <li key={point.title} className="flex gap-4">
              <point.icon className="mt-0.5 size-5 shrink-0 text-brand-600 dark:text-brand-400" />
              <div>
                <h3 className="font-semibold">{point.title}</h3>
                <p className="text-sm text-fd-muted-foreground">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <Link
          href="/getting-started/deployment"
          className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          Deploy your own
          <FaArrowRight className="size-3" />
        </Link>
      </div>
    </section>
  );
}
