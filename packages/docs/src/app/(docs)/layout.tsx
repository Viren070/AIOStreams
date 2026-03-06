import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { SiKofi, SiGithubsponsors, SiDiscord } from 'react-icons/si';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      links={[
        {
          type: 'icon',
          text: 'Discord',
          url: 'https://discord.viren070.me',
          icon: <SiDiscord />,
          external: true,
        },
        {
          type: 'icon',
          text: 'Ko-fi',
          url: 'https://ko-fi.com/viren070',
          icon: <SiKofi />,
          external: true,
        },
        {
          type: 'icon',
          text: 'GitHub Sponsors',
          url: 'https://github.com/sponsors/Viren070',
          icon: <SiGithubsponsors />,
          external: true,
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
