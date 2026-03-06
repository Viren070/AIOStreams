import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import { DonateIconButton } from '@/components/donate-button';
import { SiDiscord } from 'react-icons/si';

export const gitConfig = {
  user: 'Viren070',
  repo: 'AIOStreams',
  branch: 'main',
};

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
