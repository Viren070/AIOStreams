import Link from 'next/link';
import type { Metadata } from 'next';
import { Email, LegalPage, REPO } from '@/components/legal-page';
import { gitConfig } from '@/lib/layout.shared';
import { canonical, sharedOpenGraph } from '@/lib/site';

const DESCRIPTION =
  'The terms for using AIOStreams, its apps, this site and the instances its developer runs.';

export const metadata: Metadata = {
  title: 'Terms',
  description: DESCRIPTION,
  alternates: { canonical: canonical('/terms') },
  openGraph: {
    ...sharedOpenGraph,
    url: canonical('/terms'),
    title: 'Terms',
    description: DESCRIPTION,
  },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="10 November 2026">
      <p>
        These terms apply to AIOStreams: the software, its apps, this site and
        the instances its developer runs. &ldquo;We&rdquo; means the AIOStreams
        project and its developers. By using AIOStreams, you agree to these
        terms, and to your data being handled as the{' '}
        <Link href="/privacy">privacy policy</Link> describes.
      </p>

      <h2>What AIOStreams is</h2>
      <p>
        AIOStreams is free, open-source software with no library of its own. It
        connects to the addons, debrid services, Usenet providers, IPTV
        providers and media servers that you choose and configure, and passes on
        what they return. AIOStreams, its apps and this site do not host, store
        or distribute films, shows, channels or any other content.
      </p>

      <h2>Who can use it</h2>
      <p>
        You need to be old enough to use online services where you live, or have
        permission from a parent or guardian.
      </p>

      <h2>Using AIOStreams</h2>
      <p>
        You decide what AIOStreams connects to and what you watch with it.
        You&apos;re responsible for:
      </p>
      <ul>
        <li>
          following the laws where you are, including copyright law, for what
          you access through it;
        </li>
        <li>following the terms of every service you connect to it;</li>
        <li>
          your configuration&apos;s password and API keys, and what&apos;s done
          with your configuration.
        </li>
      </ul>
      <p>Don&apos;t use AIOStreams to:</p>
      <ul>
        <li>infringe copyright or do anything else unlawful;</li>
        <li>
          get into services, accounts or media you aren&apos;t allowed to, or
          share credentials that aren&apos;t yours to share;
        </li>
        <li>
          attack, overload or scrape an instance, get around its sign-in or rate
          limits, or get in the way of other people using it.
        </li>
      </ul>
      <p>
        We don&apos;t endorse or encourage access to content you have no right
        to watch.
      </p>

      <h2>Other people&apos;s services</h2>
      <p>
        Addons, debrid services, Usenet and IPTV providers, metadata services
        and instances run by other people are not ours. We don&apos;t run them,
        control them or check what they offer, and we&apos;re not responsible
        for them or for what they return. Their own terms apply when you use
        them, and AIOStreams working with a service doesn&apos;t mean we endorse
        it. The{' '}
        <Link href="/getting-started/public-instances">public instances</Link>{' '}
        listed on this site are run by their own hosts.
      </p>
      <p>
        If you make an addon that works with AIOStreams, you&apos;re responsible
        for it and for what it returns, including having the rights to it.
      </p>

      <h2>What you share</h2>
      <p>
        Community features let you share formatters and templates with other
        people. You&apos;re responsible for what you share, and you must have
        the right to share it. Don&apos;t share anything unlawful, infringing,
        abusive or misleading, anything that collects other people&apos;s
        credentials, or anything that points people to material they have no
        right to access.
      </p>
      <p>
        When you share something, you let us host, show, copy and format it as
        needed to run these features, including passing it on to other
        AIOStreams instances that list shared items. You keep any rights you
        already have in it. We may hide or remove anything shared, at any time,
        without having to explain why.
      </p>

      <h2>The software</h2>
      <p>
        AIOStreams and its apps are licensed under the{' '}
        <a href={`${REPO}/blob/${gitConfig.branch}/LICENSE`}>
          GNU Affero General Public License, version 3
        </a>
        . That licence, not these terms, sets out what you may do with the code.
        Parts of the apps come from other open-source projects, such as libass,
        mpv and FFmpeg, under their own licences, which <strong>About</strong>{' '}
        in the app lists. The software comes as it is, without warranty of any
        kind, as sections 15 and 16 of the licence say.
      </p>

      <h2>Instances we run</h2>
      <p>
        An instance the developer runs, such as aiostreams.viren070.me, is free
        and comes as it is. It may change, slow down, lose data or stop at any
        time, without notice. It isn&apos;t a backup service, so keep your own
        copy of your configuration. We may limit, suspend or remove access,
        including deleting a configuration, if it breaks these terms, abuses the
        instance or puts it or other people at risk.
      </p>

      <h2>Privacy</h2>
      <p>
        The <Link href="/privacy">privacy policy</Link> explains what this site,
        the instances we run and the apps keep about you, and how to have it
        deleted.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        AIOStreams comes as it is, without warranties of any kind. We don&apos;t
        promise that it, or the content and services it connects to, will be
        accurate, lawful, safe, available or free of errors.
      </p>
      <p>
        As far as the law allows, we and the project&apos;s contributors
        aren&apos;t liable for any indirect, incidental or consequential loss,
        or for lost data, lost access or interrupted service, arising from your
        use of AIOStreams, its apps, this site or our instances, or from the
        services you connect to them. Where the law doesn&apos;t allow a limit
        like this, our liability is limited as far as it does allow. We&apos;re
        also not responsible for failures outside our control, such as those of
        your device, your network or a third-party service.
      </p>

      <h2>Indemnity</h2>
      <p>
        As far as the law allows, you agree to cover us and the project&apos;s
        contributors for any claims, losses and costs that arise from your use
        of AIOStreams, from what you share, or from your breaking these terms,
        the law or someone else&apos;s rights.
      </p>

      <h2>Copyright reports</h2>
      <p>
        AIOStreams hosts no films, shows or channels, so a request to remove one
        should go to the site or service that hosts it. What we do host is this
        site, the instances we run, and what people share through community
        features. If you believe something there infringes your rights, email{' '}
        <Email /> with:
      </p>
      <ul>
        <li>where it is, such as its address;</li>
        <li>the work or right involved;</li>
        <li>your contact details;</li>
        <li>what you&apos;d like us to do;</li>
        <li>
          a statement that you&apos;re the rights holder or are allowed to act
          for them.
        </li>
      </ul>
      <p>
        We&apos;ll review it, and may remove or restrict the material. We may
        also remove access for anyone who repeatedly shares material that
        infringes someone&apos;s rights.
      </p>

      <h2>Changes and ending</h2>
      <p>
        AIOStreams changes over time, and its features, apps and instances can
        change or end. You can stop using it at any time, and delete your
        configuration as above. We may update these terms. The date at the top
        shows when they last changed, and using AIOStreams after a change means
        you accept the new terms. The parts meant to last, such as the
        disclaimers, liability limits and indemnity, still apply after you stop.
      </p>

      <h2>General</h2>
      <p>
        If part of these terms can&apos;t be enforced, the rest still applies.
        Not enforcing a term doesn&apos;t mean we&apos;ve given it up. These
        terms and the AGPL make up the agreement between you and us, and for the
        code, the licence decides what you may do.
      </p>

      <h2>Contact</h2>
      <p>
        Email <Email />. For help using AIOStreams, ask on{' '}
        <a href="https://discord.viren070.me">Discord</a> or{' '}
        <a href={`${REPO}/issues`}>open an issue</a> on GitHub.
      </p>
    </LegalPage>
  );
}
