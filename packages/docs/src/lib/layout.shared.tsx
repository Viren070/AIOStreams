import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import type { LinkItemType } from 'fumadocs-ui/utils/link-item';
import Image from 'next/image';
import { DonateIconButton } from '@/components/donate-button';
import { SiDiscord, SiGithubsponsors, SiKofi } from 'react-icons/si';

export const gitConfig = {
  user: 'Viren070',
  repo: 'AIOStreams',
  branch: 'main',
};

export function sidebarLinks(crossLink: LinkItemType): LinkItemType[] {
  return [
    crossLink,
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
  ];
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span className="relative inline-flex h-6 w-6 shrink-0">
            <Image
              src="/logo-light.png"
              alt="AIOStreams"
              fill
              className="object-contain transition-opacity duration-300 dark:opacity-0"
            />
            <Image
              src="/logo-dark.png"
              alt=""
              fill
              className="object-contain transition-opacity duration-300 opacity-0 dark:opacity-100"
            />
          </span>
          AIOStreams
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        type: 'main',
        text: 'Changelog',
        url: '/changelog',
      },
      {
        type: 'icon',
        text: 'Discord',
        url: 'https://discord.viren070.me',
        icon: <SiDiscord />,
        external: true,
      },
      {
        type: 'custom',
        secondary: true,
        children: <DonateIconButton />,
      },
    ],
  };
}
