import Link from 'next/link';
import type { Metadata } from 'next';
import { Email, LegalPage } from '@/components/legal-page';
import { canonical, sharedOpenGraph } from '@/lib/site';

const DESCRIPTION =
  'What this site, the AIOStreams instances its developer runs and the apps keep about you, why, for how long, and how to have it deleted.';

export const metadata: Metadata = {
  title: 'Privacy',
  description: DESCRIPTION,
  alternates: { canonical: canonical('/privacy') },
  openGraph: {
    ...sharedOpenGraph,
    url: canonical('/privacy'),
    title: 'Privacy',
    description: DESCRIPTION,
  },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="10 November 2026">
      <p>
        This policy explains what AIOStreams keeps about you and why: on this
        site, on the instances its developer runs, such as
        aiostreams.viren070.me, and in its apps. Instances run by other people
        are covered by their owners, not by this policy; see{' '}
        <a href="#other-instances">other instances</a>. &ldquo;We&rdquo; means
        the AIOStreams project and its developers.
      </p>

      <h2>Who is responsible</h2>
      <p>
        AIOStreams&apos; developer runs this site and the instances listed as
        theirs on{' '}
        <Link href="/getting-started/public-instances">public instances</Link>,
        and is responsible for the data they keep. Send privacy questions and
        requests to <Email />.
      </p>

      <h2>This site</h2>
      <p>
        This site counts visits with Plausible, which runs on our own server,
        sets no cookies and doesn&apos;t identify you. Your browser remembers
        whether you chose the light or dark theme. The host that serves the site
        sees your IP address, as with any website.
      </p>

      <h2>Instances we run</h2>
      <p>
        AIOStreams doesn&apos;t ask for your name or email address. An instance
        keeps what it needs to work:
      </p>
      <ul>
        <li>
          <strong>Your configuration</strong>, including the API keys and
          accounts in it, stored encrypted. Your password is stored only as a
          hash.
        </li>
        <li>
          <strong>What you watch in the apps</strong>: your progress, watch
          history, favourites, ratings, watchlist and playlists, and the name
          and app version of each device you watch on, so they follow you
          between devices and Jellyfin apps.
        </li>
        <li>
          <strong>Usage counts</strong>: how many requests each addon gets, how
          long they take and whether they fail. They&apos;re tied to a hash of
          your configuration&apos;s ID and the network part of your IP address
          (such as 203.0.113.x), never the full address.
        </li>
        <li>
          <strong>Server logs</strong>, which record requests, including IP
          addresses, to keep the instance running and deal with abuse.
        </li>
        <li>
          <strong>Reports from the apps</strong>, only when you send one with{' '}
          <strong>Report a problem</strong>: your device, the app&apos;s
          version, your note and the app&apos;s recent log. When a report
          reaches the developer from another instance, its passwords, tokens and
          configuration IDs are taken out first.
        </li>
        <li>
          <strong>What you share</strong> through community features, such as
          formatters and templates, which other people and other instances can
          see. A hash of your configuration&apos;s ID and of your IP address is
          kept with it, to stop repeat likes and abuse.
        </li>
      </ul>
      <p>
        We use this data to give you what you ask for, to keep the instances
        secure and working, which is in our legitimate interest, and to meet the
        law.
      </p>

      <h2>Who receives your data</h2>
      <ul>
        <li>
          <strong>The services in your configuration.</strong> To find streams,
          the instance sends your requests to your addons and services, with the
          API keys you gave for each. It also passes on your IP address, which
          debrid services need for working links, unless that addon goes through
          a proxy in your configuration.
        </li>
        <li>
          <strong>Where you send playback.</strong> A stream plays from its
          source, which sees your IP address. If you choose another player, such
          as VLC, it receives the stream&apos;s link.
        </li>
        <li>
          <strong>Hosting providers</strong> that run the servers for this site
          and our instances.
        </li>
      </ul>
      <p>
        Those services handle your data under their own terms and policies. We
        don&apos;t sell your data or use it for advertising. We only share it as
        described here, when you ask us to, when the law requires it, or to
        protect people or the service.
      </p>

      <h2>The apps</h2>
      <p>
        The apps keep your settings, sign-ins and downloads on your device. They
        connect to the server you sign in to and to the sources its streams and
        subtitles come from, to YouTube for trailers, and, in the desktop and
        Android apps, to GitHub to check for new versions. They send a report
        only when you choose to.
      </p>
      <p>
        Once a day, the apps also send usage statistics to Aptabase, which runs
        on our own server: that the app was used, the device&apos;s model and
        system, the app&apos;s version and your language. Aptabase works out
        your country and region from your IP address and doesn&apos;t keep the
        address. No ID is sent with them, so the counts can&apos;t be tied to
        you, your server or what you watch. The apps tell you before sending
        any, and you can turn it off in their settings, under{' '}
        <strong>About</strong>.
      </p>

      <h2>How long it&apos;s kept</h2>
      <ul>
        <li>
          Your configuration and what you watch: until you delete them, or the
          instance removes the configuration.
        </li>
        <li>
          Usage counts: single requests for 7 days, and daily totals for 90.
        </li>
        <li>Reports from the apps: 7 days.</li>
        <li>Usage statistics from the apps: 5 years.</li>
        <li>
          Server logs: only as long as needed to run and protect the instance.
        </li>
        <li>What you share: while it&apos;s listed.</li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        <strong>Delete User</strong>, under <strong>Save &amp; Install</strong>{' '}
        on the configure page, deletes your configuration along with what
        you&apos;ve watched and your app reports. Logs and usage counts expire
        on their own, and copies may stay in backups for a limited time.
      </p>
      <p>
        Deleting your configuration doesn&apos;t delete what the services you
        connected keep, such as a debrid service, Trakt or an addon. Ask them
        directly.
      </p>

      <h2>Security</h2>
      <p>
        Configurations are encrypted and passwords hashed, and instances are
        reached over HTTPS. No system is completely secure, though, and addons
        and services you add may protect your data less well, especially over
        plain HTTP. Never put passwords or API keys in a report or a message to
        us. If we learn of a breach, we&apos;ll work to contain it, and tell the
        people affected and the authorities where the law requires it.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have the right to see, correct,
        export or delete your data, to object to how it&apos;s used, and to
        complain to your data protection authority. Email <Email /> to ask.
        Since AIOStreams doesn&apos;t know your name or email address,
        we&apos;ll need to confirm which configuration is yours first, for
        example by you signing in to it.
      </p>

      <h2>Where it&apos;s processed</h2>
      <p>
        Our servers and the services you connect may be in another country from
        yours. Your local privacy rights still apply.
      </p>

      <h2>Children</h2>
      <p>
        AIOStreams isn&apos;t meant for children who can&apos;t agree to this
        without a parent&apos;s or guardian&apos;s permission. If you think a
        child has used it without that permission, email <Email /> and
        we&apos;ll delete their data where appropriate.
      </p>

      <h2 id="other-instances">Other instances</h2>
      <p>
        Instances run by other people use the same software, but their owners
        choose its settings and can see what it keeps. A self-hosted instance
        can, for example, keep a history of the streams it serves with each
        viewer&apos;s IP address. Ask an instance&apos;s owner how they handle
        your data.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy when AIOStreams or the way it handles data
        changes. The date at the top shows when it last changed, and we&apos;ll
        announce bigger changes on this site.
      </p>
    </LegalPage>
  );
}
