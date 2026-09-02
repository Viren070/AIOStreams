import { getChangelogEntries } from '@/lib/source';

export const revalidate = false;
export const dynamic = 'force-static';
export function GET() {
  const entries = getChangelogEntries().map((page) => ({
    version: page.data.version ?? null,
    title: page.data.title,
    description: page.data.description ?? null,
    date: new Date(page.data.date).toISOString().slice(0, 10),
    url: page.url,
  }));

  return Response.json(entries, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=600, stale-while-revalidate=86400',
    },
  });
}
