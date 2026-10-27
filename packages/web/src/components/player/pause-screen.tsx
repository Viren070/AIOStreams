import { t } from '@lingui/core/macro';
import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../../lib/session';
import { logoUrl } from '../../lib/images';
import { itemTitle } from '../../lib/format';
import { CachedImage } from '../cached-image';
import type { BaseItemDto } from '../../lib/types';

function episodeLine(item: BaseItemDto): string {
  const season = item.ParentIndexNumber;
  const number = item.IndexNumber;
  return [
    season == null ? null : season === 0 ? t`Specials` : t`Season ${season}`,
    number == null ? null : t`Episode ${number}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What's playing, over the dimmed picture while it stays paused. */
export function PauseScreen({
  item,
  shown,
}: {
  item: BaseItemDto;
  shown: boolean;
}) {
  const { client } = useSession();
  const logo = logoUrl(client, item, { maxWidth: 640 });
  const [failedLogo, setFailedLogo] = React.useState<string>();
  const title = itemTitle(item);
  const episode = item.Type === 'Episode';
  const line = episode ? episodeLine(item) : '';
  return (
    <div
      data-ui="pause-screen"
      data-visible={shown || undefined}
      aria-hidden={!shown}
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center bg-black/30 transition-opacity duration-700 ease-out',
        shown ? 'opacity-100' : 'opacity-0'
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-transparent rtl:bg-gradient-to-l" />
      <div className="relative max-w-[min(42rem,70vw)] space-y-3 ps-[max(1.5rem,8vw)]">
        {logo && failedLogo !== logo ? (
          <CachedImage
            data-ui="pause-logo"
            src={logo}
            alt={title}
            onError={() => setFailedLogo(logo)}
            className="max-h-[16vh] w-auto max-w-[min(100%,24rem)] object-contain object-left rtl:object-right"
          />
        ) : (
          <p
            data-ui="pause-title"
            className="text-balance text-3xl font-bold sm:text-5xl"
          >
            {title}
          </p>
        )}
        {episode && (line || item.Name) && (
          <div className="space-y-1 pt-2">
            {line && (
              <p
                data-ui="pause-episode"
                className="text-sm font-medium text-white/70 sm:text-base"
              >
                {line}
              </p>
            )}
            {item.Name && (
              <p
                data-ui="pause-episode-title"
                className="text-xl font-semibold sm:text-2xl"
              >
                {item.Name}
              </p>
            )}
          </div>
        )}
        {item.Overview && (
          <p
            data-ui="pause-overview"
            className="line-clamp-4 text-sm text-gray-200 sm:text-base"
          >
            {item.Overview}
          </p>
        )}
      </div>
    </div>
  );
}
