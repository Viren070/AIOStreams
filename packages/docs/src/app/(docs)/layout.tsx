import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { FaRegNewspaper } from 'react-icons/fa';
import { baseOptions, sidebarLinks } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      links={sidebarLinks({
        type: 'main',
        text: 'Changelog',
        url: '/changelog',
        icon: <FaRegNewspaper />,
      })}
    >
      {children}
    </DocsLayout>
  );
}
