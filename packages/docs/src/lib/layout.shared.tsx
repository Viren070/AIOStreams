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
          <Image
            src="/logo.png"
            alt="AIOStreams"
            width={24}
            height={24}
            className="rounded"
          />
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
