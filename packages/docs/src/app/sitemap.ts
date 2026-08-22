import type { MetadataRoute } from 'next';
import { getChangelogEntries, source } from '@/lib/source';
import { canonical } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: canonical('/'), changeFrequency: 'weekly', priority: 1 },
    { url: canonical('/changelog'), changeFrequency: 'weekly', priority: 0.8 },
    ...source.getPages().map((page) => ({
      url: canonical(page.url),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...getChangelogEntries().map((entry) => ({
      url: canonical(entry.url),
      lastModified: new Date(entry.data.date),
      changeFrequency: 'yearly' as const,
      priority: 0.5,
    })),
  ];
}
