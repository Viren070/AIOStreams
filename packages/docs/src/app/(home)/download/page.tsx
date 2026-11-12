import Link from 'next/link';
import type { Metadata } from 'next';
import { FaGithub } from 'react-icons/fa6';
import { SiJellyfin, SiStremio } from 'react-icons/si';
import { DownloadPicker } from '@/components/download-picker';
import { appVersions } from '@/lib/app-versions';
import { ALL_RELEASES, NIGHTLY } from '@/lib/downloads';
import { canonical, sharedOpenGraph } from '@/lib/site';

const DESCRIPTION =
  'The AIOStreams app for Windows, macOS, Linux, Android, Android TV, Fire TV and LG and Samsung TVs.';

export const metadata: Metadata = {
  title: 'Download',
  description: DESCRIPTION,
  alternates: { canonical: canonical('/download') },
  openGraph: {
    ...sharedOpenGraph,
    url: canonical('/download'),
    title: 'Download',
    description: DESCRIPTION,
  },
};

const STEPS = [
  {
    title: 'Make a configuration',
    body: (
      <>
        On a{' '}
        <Link href="/getting-started/public-instances" className="underline">
          public instance
        </Link>{' '}
        or{' '}
        <Link href="/getting-started/deployment" className="underline">
          your own
        </Link>
        : add your services and addons, then save it with a password.
      </>
    ),
  },
  {
    title: 'Install the app',
    body: 'Every app is the same app, with the same pages and settings, made for its screen.',
  },
  {
    title: 'Sign in',
    body: (
      <>
        Press <strong>Open in app</strong> under{' '}
        <strong>Save &amp; Install</strong>, or approve a{' '}
        <strong>Quick Connect</strong> code on a TV.{' '}
        <Link href="/apps#signing-in" className="underline">
          More on signing in
        </Link>
      </>
    ),
  },
];

const card = 'rounded-2xl border border-fd-border bg-fd-card/60 p-6';

export default function DownloadPage() {
  return (
    <main className="relative w-full flex-1 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(97_82_223/0.22),transparent)]"
      />
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-20 sm:px-6">
        <div className="mb-10 flex flex-col items-center text-center">
          <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
            Get the app
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-fd-muted-foreground md:text-xl">
            Your catalogs, streams and Live TV on your computer, phone and TV.
            It signs in to an AIOStreams configuration, on a public instance or
            your own.
          </p>
        </div>

        <DownloadPicker versions={appVersions()} />

        <section className="mt-24">
          <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight md:text-3xl">
            From download to watching
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className={card}>
                <span className="mb-4 block bg-gradient-to-br from-brand-400 to-brand-600 bg-clip-text text-4xl font-bold text-transparent">
                  {i + 1}
                </span>
                <h3 className="mb-1 font-semibold">{step.title}</h3>
                <p className="text-sm text-fd-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <div className={card}>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <SiStremio /> In Stremio instead
            </h2>
            <p className="mb-4 text-sm text-fd-muted-foreground">
              AIOStreams is also a Stremio addon, with nothing to download.
              Install it from <strong>Save &amp; Install</strong> on the
              configure page.
            </p>
            <Link
              href="/getting-started"
              className="text-sm font-medium hover:underline"
            >
              Getting started →
            </Link>
          </div>
          <div className={card}>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <SiJellyfin /> Have a Jellyfin server?
            </h2>
            <p className="mb-4 text-sm text-fd-muted-foreground">
              The apps sign in to Jellyfin servers too, so your library can sit
              in the same app as your configuration. Add it with{' '}
              <strong>Change server</strong> under{' '}
              <strong>Settings → Account</strong>.
            </p>
            <Link
              href="/apps#jellyfin-servers"
              className="text-sm font-medium hover:underline"
            >
              Jellyfin servers →
            </Link>
          </div>
          <div className={card}>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <FaGithub /> Nightly builds and older versions
            </h2>
            <p className="mb-4 text-sm text-fd-muted-foreground">
              Nightly builds come from every change, ahead of releases. They get
              fixes sooner but can break. The desktop and Android apps can
              switch to them in their settings.
            </p>
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium">
              {NIGHTLY.map((nightly) => (
                <a
                  key={nightly.href}
                  href={nightly.href}
                  className="hover:underline"
                >
                  {nightly.name} nightly →
                </a>
              ))}
              <a href={ALL_RELEASES} className="hover:underline">
                All releases →
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
