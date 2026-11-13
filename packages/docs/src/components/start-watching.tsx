'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FaArrowRight, FaDownload } from 'react-icons/fa6';
import type { AppVersions } from '@/lib/app-versions';
import { DOWNLOADS, type DownloadOption, type Platform } from '@/lib/downloads';
import { PLATFORM_ICONS, usePlatform } from '@/lib/platform';
import { Caveat } from '@/components/download-picker';
import { cn } from '@/lib/cn';

const TILES: Array<{ platform: Platform; name: string; note?: string }> = [
  { platform: 'windows', name: 'Windows' },
  { platform: 'mac', name: 'macOS' },
  { platform: 'linux', name: 'Linux' },
  { platform: 'android', name: 'Android' },
  { platform: 'android-tv', name: 'Android TV', note: 'Fire TV and Google TV' },
  { platform: 'lg', name: 'LG TVs' },
  { platform: 'samsung', name: 'Samsung TVs' },
  { platform: 'browser', name: 'Any browser', note: 'Nothing to install' },
];

const versionOf = (
  option: DownloadOption | undefined,
  versions: AppVersions
) => (option?.app ? versions[option.app] : undefined);

export function StartWatching({ versions }: { versions: AppVersions }) {
  const { detected, ready } = usePlatform();
  const mine = DOWNLOADS.find((d) => d.platform === detected?.platform);
  const file = mine?.files[detected?.file ?? 0];

  const steps: Array<{ title: string; body: ReactNode; action: ReactNode }> = [
    {
      title: 'Make a configuration',
      body: 'On a public instance, free and with nothing to host, or on your own. Add your services and addons, then save it with a password.',
      action: (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/getting-started/public-instances" className={linkClass}>
            Find a public instance <FaArrowRight className="size-3" />
          </Link>
          <Link href="/configuration/setup" className={linkClass}>
            Follow the setup guide <FaArrowRight className="size-3" />
          </Link>
        </div>
      ),
    },
    {
      title: 'Get the app',
      body: (
        <>
          For your computer, phone or TV, or open it in any browser at{' '}
          <a
            href="https://web.aiostreams.org"
            className="font-medium text-fd-foreground hover:underline"
          >
            web.aiostreams.org
          </a>
          . In Stremio, install it as an addon instead.
        </>
      ),
      action:
        ready && mine && file ? (
          <>
            <a href={file.href} className={primaryClass}>
              <FaDownload className="size-3.5" />
              Download for {mine.name}
              {versionOf(mine, versions) && (
                <span className="font-normal text-white/70">
                  v{versionOf(mine, versions)}
                </span>
              )}
            </a>
            {mine.caveat && (
              <Caveat className="mt-3 max-w-md">{mine.caveat}</Caveat>
            )}
          </>
        ) : (
          <Link href="/download" className={primaryClass}>
            <FaDownload className="size-3.5" />
            Download the app
          </Link>
        ),
    },
    {
      title: 'Sign in',
      body: 'Press Open in app on the configure page, or approve a Quick Connect code on a TV. Your catalogs, streams and channels are there.',
      action: (
        <Link href="/apps#signing-in" className={linkClass}>
          Signing in <FaArrowRight className="size-3" />
        </Link>
      ),
    },
  ];

  return (
    <section className="overflow-hidden border-t border-fd-border">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="mb-2 text-sm font-medium text-brand-600 dark:text-brand-400">
            Get started
          </p>
          <h2 className="mb-10 text-3xl font-semibold tracking-tight md:text-4xl">
            Start watching in three steps
          </h2>
          <ol className="relative flex flex-col gap-9">
            <span
              aria-hidden
              className="absolute bottom-6 left-[1.0625rem] top-6 w-px bg-gradient-to-b from-brand-500/60 via-fd-border to-fd-border"
            />
            {steps.map((step, i) => (
              <li key={step.title} className="relative flex gap-5">
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-brand-500/40 bg-fd-background text-sm font-semibold text-brand-600 shadow-[0_0_0_4px_var(--color-fd-background)] dark:text-brand-300">
                  {i + 1}
                </span>
                <div className="pt-1">
                  <h3 className="mb-1 text-lg font-semibold">{step.title}</h3>
                  <p className="mb-3 max-w-md text-sm text-fd-muted-foreground">
                    {step.body}
                  </p>
                  {step.action}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative isolate grid grid-cols-2 gap-3">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-24 -z-10 bg-[radial-gradient(closest-side,rgb(97_82_223/0.2),transparent)]"
          />
          {TILES.map((tile) => {
            const option = DOWNLOADS.find((d) => d.platform === tile.platform);
            const Icon = PLATFORM_ICONS[tile.platform];
            const version = versionOf(option, versions);
            const yours = tile.platform === detected?.platform;
            return (
              <Link
                key={tile.platform}
                href={`/download#${tile.platform}`}
                className={cn(
                  'group relative flex items-center gap-3 rounded-2xl border bg-fd-card/80 p-3 backdrop-blur sm:gap-4 sm:p-4 transition-[border-color,box-shadow] hover:border-brand-500/50 hover:shadow-lg hover:shadow-brand-500/10',
                  yours ? 'border-brand-500/60' : 'border-fd-border'
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fd-muted to-fd-muted/40 text-lg sm:size-11 sm:text-xl text-fd-foreground transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-300">
                  <Icon />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium sm:text-base">
                    {tile.name}
                  </span>
                  <span className="block text-xs text-fd-muted-foreground">
                    {yours
                      ? 'Your device'
                      : (tile.note ??
                        [version && `v${version}`, option?.beta && 'Beta']
                          .filter(Boolean)
                          .join(' · '))}
                  </span>
                </span>
                <FaArrowRight className="ml-auto hidden size-3 shrink-0 text-fd-muted-foreground opacity-0 sm:block transition-opacity group-hover:opacity-100" />
              </Link>
            );
          })}
          <Link
            href="/apps/jellyfin"
            className="col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-fd-border p-3 text-sm text-fd-muted-foreground transition-colors hover:border-brand-500/50 hover:text-fd-foreground"
          >
            iPhone, iPad, Apple TV or Kodi? Use a Jellyfin app
            <FaArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </section>
  );
}

const primaryClass =
  'inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-500/25 transition-colors hover:bg-brand-600';
const linkClass =
  'inline-flex items-center gap-1.5 text-sm font-medium hover:underline';
