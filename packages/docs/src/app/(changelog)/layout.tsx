import type * as PageTree from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { FaBook } from 'react-icons/fa';
import { getChangelogEntries } from '@/lib/source';
import { baseOptions, sidebarLinks } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <DocsLayout
      tree={changelogTree()}
      {...baseOptions()}
      links={sidebarLinks({
        type: 'main',
        text: 'Documentation',
        url: '/getting-started',
        icon: <FaBook />,
      })}
    >
      {children}
    </DocsLayout>
  );
}

function changelogTree(): PageTree.Root {
  return {
    name: 'Changelog',
    children: getChangelogEntries().map((entry) => ({
      type: 'page',
      url: entry.url,
      name: (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            {entry.data.version ? `v${entry.data.version}` : entry.slugs.at(-1)}
          </span>
          <span className="text-xs opacity-70">{entry.data.title}</span>
        </span>
      ),
    })),
  };
}
