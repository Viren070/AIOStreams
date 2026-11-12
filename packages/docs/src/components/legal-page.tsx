import type { ReactNode } from 'react';
import { gitConfig } from '@/lib/layout.shared';

export const REPO = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
export const CONTACT = 'contact@aiostreams.org';

export const Email = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="w-full flex-1">
      <article className="prose mx-auto w-full max-w-3xl px-4 pb-24 pt-16 sm:px-6">
        <h1>{title}</h1>
        <p className="text-fd-muted-foreground">Last updated {updated}</p>
        {children}
      </article>
    </main>
  );
}
