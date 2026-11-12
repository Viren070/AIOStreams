'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FaArrowDown, FaArrowRight, FaDownload } from 'react-icons/fa6';
import { LuInfo } from 'react-icons/lu';
import type { AppVersions } from '@/lib/app-versions';
import {
  CATEGORIES,
  DOWNLOADS,
  type DownloadFile,
  type DownloadOption,
} from '@/lib/downloads';
import { PLATFORM_ICONS, usePlatform, type Detected } from '@/lib/platform';
import { cn } from '@/lib/cn';

const versionOf = (
  option: DownloadOption | undefined,
  versions: AppVersions
) => (option?.app ? versions[option.app] : undefined);

export function DownloadPicker({ versions }: { versions: AppVersions }) {
  const { detected, ready } = usePlatform();
  return (
    <>
      <Suggestion detected={detected} ready={ready} versions={versions} />
      <div className="relative mx-auto mt-14 max-w-5xl">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 h-3/4 bg-[radial-gradient(ellipse_at_center,rgb(97_82_223/0.25),transparent_70%)] blur-2xl"
        />
        <Image
          src="/apps/hero.webp"
          alt="The AIOStreams app on a TV, a computer and a phone"
          width={2940}
          height={2000}
          priority
          className="h-auto w-full"
        />
      </div>
      <div id="all" className="mt-20 flex scroll-mt-24 flex-col gap-12">
        {CATEGORIES.map((category) => (
          <section key={category.id}>
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-fd-muted-foreground">
              {category.name}
            </h2>
            <div className="overflow-hidden rounded-2xl border border-fd-border bg-fd-card/60">
              {DOWNLOADS.filter((d) => d.category === category.id).map(
                (option, i) => (
                  <PlatformRow
                    key={option.platform}
                    option={option}
                    version={versionOf(option, versions)}
                    yours={option.platform === detected?.platform}
                    first={i === 0}
                  />
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function Suggestion({
  detected,
  ready,
  versions,
}: {
  detected: Detected | null;
  ready: boolean;
  versions: AppVersions;
}) {
  const option = DOWNLOADS.find((d) => d.platform === detected?.platform);
  const file = option?.files[detected?.file ?? 0];
  const version = versionOf(option, versions);
  const button =
    'inline-flex items-center gap-2.5 rounded-full bg-brand-500 px-7 py-3.5 text-base font-medium text-white shadow-xl shadow-brand-500/30 transition-colors hover:bg-brand-600';
  return (
    // Keeps its height while detecting, so nothing below moves.
    <div className="flex min-h-28 flex-col items-center gap-4">
      <div
        className={cn(
          'flex flex-wrap items-center justify-center gap-3 transition-opacity duration-300',
          ready ? 'opacity-100' : 'opacity-0'
        )}
      >
        {option && file ? (
          <a href={file.href} className={button}>
            <FaDownload className="size-4" />
            Download for {option.name}
          </a>
        ) : option ? (
          <Link href={option.guide.href} className={button}>
            {option.guide.label}
            <FaArrowRight className="size-4" />
          </Link>
        ) : (
          <a href="#all" className={button}>
            Choose your device
            <FaArrowDown className="size-4" />
          </a>
        )}
        {option && (
          <a
            href="#all"
            className="inline-flex items-center gap-2 rounded-full border border-fd-border px-6 py-3.5 text-base font-medium transition-colors hover:bg-fd-muted"
          >
            All platforms
          </a>
        )}
      </div>
      {ready && option && (
        <p className="text-sm text-fd-muted-foreground">
          {[
            version && `v${version}`,
            file?.detail ?? file?.label,
            option.requirement,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {ready && option?.caveat && (
        <Caveat className="max-w-xl justify-center text-center">
          {option.caveat}
        </Caveat>
      )}
    </div>
  );
}

export function Caveat({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 text-xs text-fd-muted-foreground',
        className
      )}
    >
      <LuInfo className="mt-px size-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
      <span>{children}</span>
    </p>
  );
}

function PlatformRow({
  option,
  version,
  yours,
  first,
}: {
  option: DownloadOption;
  version?: string;
  yours: boolean;
  first: boolean;
}) {
  const Icon = PLATFORM_ICONS[option.platform];
  return (
    <div
      id={option.platform}
      className={cn(
        'relative flex scroll-mt-24 flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start',
        !first && 'border-t border-fd-border',
        yours && 'bg-brand-500/[0.06]'
      )}
    >
      {yours && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-brand-500"
        />
      )}
      <div className="flex min-w-0 flex-1 gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fd-muted to-fd-muted/30 text-2xl">
          <Icon />
        </span>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {option.name}
            {version && (
              <span className="rounded-full bg-fd-muted px-2 py-0.5 text-xs font-medium text-fd-muted-foreground">
                v{version}
              </span>
            )}
            {option.beta && (
              <span className="rounded-full border border-fd-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fd-muted-foreground">
                Beta
              </span>
            )}
            {yours && (
              <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-brand-600 dark:text-brand-300">
                Your device
              </span>
            )}
          </h3>
          <p className="text-sm text-fd-muted-foreground">
            {option.requirement}
          </p>
          <p className="mt-2 text-xs text-fd-muted-foreground/80">
            {option.notes.join(' ')}{' '}
            <Link
              href={option.guide.href}
              className="whitespace-nowrap font-medium text-fd-foreground hover:underline"
            >
              {option.guide.label} →
            </Link>
          </p>
          {option.caveat && (
            <Caveat className="mt-3 max-w-xl rounded-lg bg-fd-muted/60 px-3 py-2">
              {option.caveat}
            </Caveat>
          )}
        </div>
      </div>
      {option.files.length > 0 && (
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:w-[27rem] sm:grid-cols-2">
          {option.files.map((file, i) => (
            <FileButton key={file.href} file={file} primary={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileButton({
  file,
  primary,
}: {
  file: DownloadFile;
  primary: boolean;
}) {
  return (
    <a
      href={file.href}
      title={file.detail}
      className={cn(
        'group inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
        primary
          ? 'bg-fd-foreground text-fd-background hover:bg-fd-foreground/85'
          : 'border border-fd-border hover:border-brand-500/50 hover:bg-brand-500/5'
      )}
    >
      <FaDownload className="size-3 shrink-0" />
      {file.label}
      {file.code && (
        <span
          className={cn(
            'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px]',
            primary
              ? 'bg-fd-background/15'
              : 'bg-fd-muted text-fd-muted-foreground'
          )}
          title="Downloader code"
        >
          {file.code}
        </span>
      )}
    </a>
  );
}
