import type { IconType } from 'react-icons';
import { LuExternalLink } from 'react-icons/lu';
import {
  SiAnilist,
  SiImdb,
  SiKitsu,
  SiMyanimelist,
  SiThemoviedatabase,
  SiTrakt,
} from 'react-icons/si';
import { IconButton } from '@aiostreams/ui/button';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { AnidbIcon, TvdbIcon } from './brand-icons';

const ICONS: Record<string, IconType> = {
  imdb: SiImdb,
  tmdb: SiThemoviedatabase,
  trakt: SiTrakt,
  anilist: SiAnilist,
  myanimelist: SiMyanimelist,
  kitsu: SiKitsu,
  thetvdb: TvdbIcon,
  anidb: AnidbIcon,
};

export function ExternalLinks({
  links,
}: {
  links: { Name?: string | null; Url?: string | null }[] | null | undefined;
}) {
  const usable = (links ?? []).filter(
    (link): link is { Name: string; Url: string } => !!link.Name && !!link.Url
  );
  if (!usable.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {usable.map((link) => {
        const Icon = ICONS[link.Name.toLowerCase()] ?? LuExternalLink;
        return (
          <Tooltip
            key={link.Url}
            trigger={
              <a
                href={link.Url}
                target="_blank"
                rel="noreferrer"
                aria-label={link.Name}
              >
                <IconButton
                  size="sm"
                  intent="gray-link"
                  className="px-1.5"
                  icon={<Icon className="text-xl" />}
                  tabIndex={-1}
                />
              </a>
            }
          >
            {link.Name}
          </Tooltip>
        );
      })}
    </div>
  );
}
