import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { BiExpand, BiHeart, BiPlay, BiSolidHeart } from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../../lib/session';
import { posterUrl } from '../../lib/images';
import { airTime, duration, episodeCode } from '../../lib/format';
import { useSetFavorite } from '../../lib/queries';
import { useDockRef } from '../../lib/playback/dock';
import { airedShare, airingAt, endOf, startOf } from '../../lib/live-tv';
import type { BaseItemDto } from '../../lib/types';
import { CachedImage } from '../../components/cached-image';

const LATER = 4;

function timeRange(p: BaseItemDto): string {
  const from = p.StartDate ? airTime(p.StartDate) : null;
  const to = p.EndDate ? airTime(p.EndDate) : null;
  return from && to ? `${from} – ${to}` : (from ?? '');
}

/**
 * Where the playing channel shows, which the mini player draws its video into.
 * Before anything plays, the channel's art stands in.
 */
export function Preview({
  channel,
  programme,
  playing,
  onPress,
  className,
}: {
  channel?: BaseItemDto;
  programme?: BaseItemDto;
  playing: boolean;
  onPress(): void;
  className?: string;
}) {
  const { client } = useSession();
  const dock = useDockRef();
  const art =
    (programme && posterUrl(client, programme, { maxWidth: 640 })) ??
    (channel && posterUrl(client, channel, { maxWidth: 320 }));
  return (
    <button
      ref={dock}
      type="button"
      data-ui="live-preview"
      data-playing={playing || undefined}
      aria-label={playing ? t`Full screen` : t`Watch`}
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-2xl bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
        className
      )}
      onClick={onPress}
    >
      {!playing && art && (
        <CachedImage
          src={art}
          alt=""
          className={cn(
            'absolute inset-0 h-full w-full',
            programme
              ? 'object-cover opacity-50'
              : 'object-contain p-10 opacity-60'
          )}
        />
      )}
      {!playing && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-3xl">
            <BiPlay className="ms-1" />
          </span>
        </span>
      )}
    </button>
  );
}

export function ChannelDetails({
  channel,
  programmes,
  now,
  playing,
  onWatch,
}: {
  channel: BaseItemDto;
  programmes: BaseItemDto[] | undefined;
  now: number;
  playing: boolean;
  onWatch(): void;
}) {
  const setFavorite = useSetFavorite();
  const favorite = !!channel.UserData?.IsFavorite;
  const current =
    (programmes && airingAt(programmes, now)) ??
    (channel.CurrentProgram && airingAt([channel.CurrentProgram], now));
  const later = (programmes ?? [])
    .filter((p) => startOf(p) > now)
    .slice(0, LATER);
  const left = current ? duration(endOf(current) - now) : '';
  const code = current?.IsSeries
    ? episodeCode(current.ParentIndexNumber, current.IndexNumber)
    : '';
  return (
    <section data-ui="channel-details" className="flex min-h-0 flex-col gap-4">
      <div className="space-y-2">
        <p
          data-name="channel"
          className="truncate text-sm font-semibold text-[--muted]"
        >
          {channel.ChannelNumber && (
            <span className="tabular-nums">{channel.ChannelNumber} · </span>
          )}
          {channel.Name}
        </p>
        {current ? (
          <>
            <h2 data-name="now" className="line-clamp-2 text-2xl font-bold">
              {current.Name}
            </h2>
            <p className="text-sm text-gray-300">
              {[code, timeRange(current), left && t`${left} left`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-white"
                style={{ width: `${airedShare(current, now) * 100}%` }}
              />
            </div>
            {current.Overview && (
              <p className="line-clamp-3 text-sm text-gray-300">
                {current.Overview}
              </p>
            )}
          </>
        ) : (
          <h2 className="text-2xl font-bold">{channel.Name}</h2>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          data-ui="live-watch"
          intent="white"
          className="rounded-full"
          leftIcon={playing ? <BiExpand /> : <BiPlay />}
          onClick={onWatch}
        >
          {playing ? <Trans>Full screen</Trans> : <Trans>Watch</Trans>}
        </Button>
        <IconButton
          data-ui="live-favourite"
          data-active={favorite || undefined}
          intent={favorite ? 'alert-subtle' : 'gray-subtle'}
          className="rounded-full"
          icon={favorite ? <BiSolidHeart /> : <BiHeart />}
          aria-label={favorite ? t`Remove favourite` : t`Add favourite`}
          title={favorite ? t`Remove favourite` : t`Add favourite`}
          loading={setFavorite.isPending}
          onClick={() =>
            setFavorite.mutate({ itemId: channel.Id!, favorite: !favorite })
          }
        />
      </div>
      {later.length > 0 && (
        <div
          data-ui="channel-later"
          className="min-h-0 space-y-1 overflow-hidden"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-[--muted]">
            <Trans>Later</Trans>
          </p>
          {later.map((p) => (
            <p key={p.Id} className="flex gap-3 truncate text-sm">
              <span className="w-14 flex-none tabular-nums text-[--muted]">
                {p.StartDate && airTime(p.StartDate)}
              </span>
              <span className="truncate">{p.Name}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
