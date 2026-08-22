import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page';
import { getMDXComponents } from '@/mdx-components';
import { changelogSource, formatChangelogDate } from '@/lib/source';
import { canonical, sharedOpenGraph } from '@/lib/site';

export default async function ChangelogEntryPage(
  props: PageProps<'/changelog/[slug]'>
) {
  const { slug } = await props.params;
  const page = changelogSource.getPage([slug]);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      breadcrumb={{
        component: (
          <div className="flex items-center gap-1.5 text-sm text-fd-muted-foreground">
            <Link
              href="/changelog"
              className="transition-opacity hover:opacity-80"
            >
              Changelog
            </Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-fd-primary">
              {page.data.title}
            </span>
          </div>
        ),
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-wrap items-center gap-2 border-b pb-6 text-xs text-fd-muted-foreground">
        <span className="rounded-full border border-fd-border bg-fd-muted/50 px-2 py-0.5 font-medium">
          {page.data.version ?? slug}
        </span>
        <time dateTime={new Date(page.data.date).toISOString()}>
          {formatChangelogDate(page.data.date)}
        </time>
      </div>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return changelogSource.getPages().map((page) => ({
    slug: page.slugs[0],
  }));
}

export const dynamicParams = false;

export async function generateMetadata(
  props: PageProps<'/changelog/[slug]'>
): Promise<Metadata> {
  const { slug } = await props.params;
  const page = changelogSource.getPage([slug]);
  if (!page) notFound();

  const image = `/og/changelog/${slug}.webp`;

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: canonical(page.url) },
    openGraph: {
      ...sharedOpenGraph,
      type: 'article',
      url: canonical(page.url),
      title: page.data.title,
      description: page.data.description,
      publishedTime: new Date(page.data.date).toISOString(),
      images: image,
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: image,
    },
  };
}
