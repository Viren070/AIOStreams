import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../../lib/session';
import { backdropUrl, logoUrl } from '../../lib/images';
import { itemSubtitle, itemTitle } from '../../lib/format';
import { CachedImage } from '../cached-image';
import type { BaseItemDto } from '../../lib/types';

/**
 * What shows from the click until the first frame: the title's logo over its
 * backdrop, which fades out over the video once it plays. Gone once faded, so
 * nothing animates over playback.
 */
export function Cover({
  item,
  hidden = false,
}: {
  item?: BaseItemDto;
  hidden?: boolean;
}) {
  const { client } = useSession();
  const [gone, setGone] = React.useState(false);
  const [backdropShown, setBackdropShown] = React.useState(false);
  const [logo, setLogo] = React.useState<'loading' | 'shown' | 'failed'>(
    'loading'
  );
  React.useEffect(() => {
    if (!hidden) setGone(false);
  }, [hidden]);
  if (gone) return null;

  const backdrop = item ? backdropUrl(client, item, { maxWidth: 1920 }) : null;
  const logoSrc = item ? logoUrl(client, item, { maxWidth: 640 }) : null;
  const title = item ? itemTitle(item) : '';
  const detail = item?.Type === 'Episode' ? itemSubtitle(item) : '';
  return (
    <div
      data-ui="player-cover"
      data-hidden={hidden || undefined}
      className={cn(
        'fixed inset-0 overflow-hidden bg-black transition-opacity duration-700 ease-out',
        hidden && 'pointer-events-none opacity-0'
      )}
      onTransitionEnd={(e) => {
        if (hidden && e.target === e.currentTarget) setGone(true);
      }}
    >
      {backdrop && (
        <CachedImage
          data-ui="player-cover-image"
          src={backdrop}
          alt=""
          onLoad={() => setBackdropShown(true)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 will-change-transform motion-safe:[animation:player-cover-drift_40s_ease-out_forwards]',
            backdropShown ? 'opacity-40' : 'opacity-0'
          )}
        />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,rgb(0_0_0/0.8)_100%)]" />
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 transition-transform duration-700 ease-out',
          hidden && 'scale-105'
        )}
      >
        {logoSrc && logo !== 'failed' ? (
          <CachedImage
            data-ui="player-cover-logo"
            src={logoSrc}
            alt={title}
            onLoad={() => setLogo('shown')}
            onError={() => setLogo('failed')}
            className={cn(
              'max-h-[26vh] w-auto max-w-[min(70vw,32rem)] object-contain drop-shadow-[0_4px_24px_rgb(0_0_0/0.6)] transition-[opacity,transform] duration-700 ease-out',
              logo === 'shown' ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
            )}
          />
        ) : (
          title && (
            <p
              data-ui="player-cover-title"
              className="max-w-3xl text-balance text-center text-3xl font-semibold drop-shadow-lg sm:text-5xl"
            >
              {title}
            </p>
          )
        )}
        {detail && (
          <p className="max-w-xl truncate text-center text-sm text-gray-300 sm:text-base">
            {detail}
          </p>
        )}
        <div className="relative mt-4 h-0.5 w-40 overflow-hidden rounded-full bg-white/15">
          <div className="absolute inset-y-0 w-1/3 rounded-full bg-white/80 [animation:player-cover-sweep_1.4s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}
