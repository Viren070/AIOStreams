import { cn } from '@/components/ui/core/styling';
import { FiGithub } from 'react-icons/fi';
import { AiOutlineDiscord } from 'react-icons/ai';
import { FaPatreon } from 'react-icons/fa6';
import { SiBuymeacoffee, SiGithubsponsors, SiKofi } from 'react-icons/si';
import { Tooltip } from '../ui/tooltip';
import { FaGlobe } from 'react-icons/fa6';
import { BiDonateHeart } from 'react-icons/bi';

type SocialIconProps = {
  id:
    | 'github'
    | 'discord'
    | 'ko-fi'
    | 'patreon'
    | 'buymeacoffee'
    | 'github-sponsors'
    | 'website'
    | 'donate';
  url: string;
  className?: string;
};

export function SocialIcon({ id, url, className }: SocialIconProps) {
  const getTooltip = () => {
    switch (id) {
      case 'github':
        return "View the addon's GitHub repository";
      case 'discord':
        return "Join the Developer's Discord";
      case 'github-sponsors':
        return 'Sponsor the Developer on GitHub';
      case 'ko-fi':
        return 'Support the Developer on Ko-fi';
      case 'patreon':
        return 'Support the Developer on Patreon';
      case 'buymeacoffee':
        return 'Support the Developer on Buy Me a Coffee';
      case 'donate':
        return 'Support the Developer';
      default:
        return null;
    }
  };

  const tooltip = getTooltip();

  return tooltip ? (
    <Tooltip
      side="top"
      trigger={<SocialIconComponent id={id} url={url} className={className} />}
    >
      {tooltip}
    </Tooltip>
  ) : (
    <SocialIconComponent id={id} url={url} className={className} />
  );
}

const SocialIconComponent = ({ id, url, className }: SocialIconProps) => {
  const getIcon = () => {
    switch (id) {
      case 'website':
        return <FaGlobe className="w-7 h-7" />;
      case 'discord':
        return <AiOutlineDiscord className="w-7 h-7" />;
      case 'github':
        return <FiGithub className="w-7 h-7" />;
      case 'github-sponsors':
        return <SiGithubsponsors className="w-7 h-7" />;
      case 'ko-fi':
        return <SiKofi className="w-7 h-7" />;
      case 'patreon':
        return <FaPatreon className="w-7 h-7" />;
      case 'buymeacoffee':
        return <SiBuymeacoffee className="w-7 h-7" />;
      case 'donate':
        return <BiDonateHeart className="w-7 h-7" />;
      default:
        return null;
    }
  };
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center justify-center text-gray-400 transition-colors hover:opacity-80 hover:text-[--brand]',
        className
      )}
    >
      {getIcon()}
    </a>
  );
};
