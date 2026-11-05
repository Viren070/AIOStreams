import React from 'react';
import { Badge } from '@aiostreams/ui/badge';
import { useSession } from '../lib/session';
import { posterUrl } from '../lib/images';
import { airedShare, airingAt } from '../lib/live-tv';
import type { BaseItemDto } from '../lib/types';
import { CachedImage } from './cached-image';
import { WideCard } from './cards';
import { ItemMenu } from './item-menu';
import { useVersionPicker } from './version-picker';

/** A channel's card: what is on now, over the channel's logo where it has no picture. */
export function ChannelCard({
  channel,
  programmes,
  now,
}: {
  channel: BaseItemDto;
  programmes: BaseItemDto[] | undefined;
  now: number;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const programme =
    (programmes && airingAt(programmes, now)) ??
    (channel.CurrentProgram && airingAt([channel.CurrentProgram], now));
  const logo = posterUrl(client, channel, { maxWidth: 240 });
  return (
    <ItemMenu item={channel}>
      <WideCard
        onClick={() => picker.play(channel)}
        image={(width) =>
          programme
            ? [posterUrl(client, programme, { maxWidth: width })].filter(
                (url): url is string => !!url
              )
            : []
        }
        standIn={
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 p-6">
            {logo && (
              <CachedImage
                src={logo}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        }
        title={channel.Name ?? ''}
        subtitle={programme?.Name ?? undefined}
        progress={programme ? airedShare(programme, now) * 100 : null}
        badge={
          channel.ChannelNumber ? (
            <Badge size="sm" intent="gray-solid">
              {channel.ChannelNumber}
            </Badge>
          ) : undefined
        }
      />
    </ItemMenu>
  );
}
