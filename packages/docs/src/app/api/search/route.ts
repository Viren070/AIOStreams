import { getChangelogEntries, source } from '@/lib/source';
import { findPath } from 'fumadocs-core/page-tree';
import {
  createSearchAPI,
  type AdvancedIndex,
} from 'fumadocs-core/search/server';

export const revalidate = false;

export const { staticGET: GET } = createSearchAPI('advanced', {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
  indexes: [
    ...source.getPages().map(
      (page): AdvancedIndex => ({
        id: page.url,
        title: page.data.title,
        description: page.data.description,
        url: page.url,
        breadcrumbs: docsBreadcrumbs(page.url),
        structuredData: page.data.structuredData,
      })
    ),
    ...getChangelogEntries().map(
      (page): AdvancedIndex => ({
        id: page.url,
        title: page.data.version
          ? `${page.data.title} (v${page.data.version})`
          : page.data.title,
        description: page.data.description,
        url: page.url,
        breadcrumbs: ['Changelog'],
        structuredData: page.data.structuredData,
      })
    ),
  ],
});

function docsBreadcrumbs(url: string): string[] | undefined {
  const tree = source.getPageTree();
  const path = findPath(
    tree.children,
    (node) => node.type === 'page' && node.url === url
  );
  if (!path) return undefined;

  path.pop(); // the page itself
  return [tree.name, ...path.map((node) => node.name)].filter(
    (name): name is string => typeof name === 'string' && name.length > 0
  );
}
