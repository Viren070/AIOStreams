import Link from 'next/link';
import { REPO } from '@/components/legal-page';
import { gitConfig } from '@/lib/layout.shared';

const LINKS = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Licence', href: `${REPO}/blob/${gitConfig.branch}/LICENSE` },
  { label: 'GitHub', href: REPO },
  { label: 'Projects', href: 'https://github.com/AIOStreams' },
  { label: 'Discord', href: 'https://discord.viren070.me' },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-fd-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-fd-muted-foreground sm:px-6">
        <p className="max-w-3xl">
          AIOStreams does not host, store or distribute any content. It connects
          to the addons, debrid services and Usenet providers you configure, and
          plays what they return. Its developers don&apos;t endorse access to
          copyrighted content: you&apos;re responsible for following the laws
          where you live and the terms of every service you use with it.
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="hover:text-fd-foreground hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
