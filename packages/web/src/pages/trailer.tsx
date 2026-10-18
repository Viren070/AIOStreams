import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { BiArrowBack, BiLinkExternal } from 'react-icons/bi';
import { LuArrowLeft, LuSkipBack, LuSkipForward } from 'react-icons/lu';
import { Button, IconButton } from '@aiostreams/ui/button';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { useItem } from '../lib/queries';
import { currentHost } from '../lib/hosts';
import { usePlayerFullscreen } from '../lib/playback/fullscreen';
import { usePlayer } from '../lib/playback/use-player';
import { videoEngine } from '../lib/playback/video';
import { isDash } from '../lib/playback/dash';
import { useAction } from '../lib/input';
import { settings, useSetting } from '../lib/settings';
import { usePlaybackPrefs, type PlaybackPrefs } from '../lib/user-config';
import { goBack, navigate, to } from '../lib/paths';
import {
  trailersOf,
  useTrailerPlayback,
  youTubeId,
  type Trailer,
} from '../lib/playback/trailers';
import type { PlayerController } from '../lib/playback/controller';
import type { BaseItemDto, SourceInfo } from '../lib/types';
import { PlayerControls } from '../components/player/controls';
import { Cover } from '../components/player/cover';
import { OBJECT_FIT, usePlayerPage } from './player';

interface TrailerProps {
  item: BaseItemDto;
  trailer: Trailer;
  onBack(): void;
  onPrevious?: () => void;
  onNext?: () => void;
  several: boolean;
}

export function TrailerPage({
  itemId,
  index,
}: {
  itemId: string;
  index: number;
}) {
  const item = useItem(itemId);
  usePlayerPage();
  const host = currentHost();
  usePlayerFullscreen(!host.player || !!host.fullscreen);
  const trailers = item.data ? trailersOf(item.data) : [];
  const trailer = trailers[index];
  const playback = useTrailerPlayback(trailer?.url);
  const prefs = usePlaybackPrefs();
  const back = () => goBack(to.item(itemId));
  const step = (by: number) =>
    navigate(to.trailer(itemId, index + by), { replace: true });

  if (!item.data || (trailer && !playback.data) || prefs.isLoading) {
    if (item.isError || playback.isError)
      return (
        <TrailerFailure message={t`This trailer didn't load.`} onBack={back} />
      );
    return <Cover item={item.data} />;
  }
  if (!trailer || !playback.data)
    return <TrailerFailure message={t`This trailer is gone.`} onBack={back} />;
  const props: TrailerProps = {
    item: item.data,
    trailer,
    onBack: back,
    onPrevious: index > 0 ? () => step(-1) : undefined,
    onNext: index < trailers.length - 1 ? () => step(1) : undefined,
    several: trailers.length > 1,
  };
  const found = playback.data;
  if (found.kind === 'external')
    return (
      <TrailerFailure
        message={t`This trailer can't play in the app.`}
        external={found.url}
        onBack={back}
      />
    );
  if (found.kind === 'embed')
    return <EmbeddedTrailer {...props} id={found.id} />;
  return <PlayedTrailer {...props} url={found.url} prefs={prefs.prefs} />;
}

const sourceOf = (url: string): SourceInfo => ({
  Id: `trailer:${url}`,
  MediaStreams: [],
});

function Controls({
  item,
  trailer,
  player,
  onBack,
  onPrevious,
  onNext,
  several,
}: TrailerProps & { player: PlayerController }) {
  const failure = player.state.error ?? '';
  return player.state.error ? (
    <TrailerFailure
      message={t`This trailer didn't play: ${failure}`}
      external={youTubeId(trailer.url) ? trailer.url : undefined}
      onBack={onBack}
    />
  ) : (
    <PlayerControls
      item={item}
      player={player}
      segments={null}
      onBack={onBack}
      caption={trailer.name}
      steps={several ? 'trailer' : undefined}
      onPrevious={onPrevious}
      onNext={onNext}
    />
  );
}

function PlayedTrailer({
  url,
  prefs,
  ...props
}: TrailerProps & { url: string; prefs: PlaybackPrefs }) {
  const { client } = useSession();
  const video = React.useRef<HTMLVideoElement>(null);
  // A DASH manifest plays in the page's own video, through Shaka (dash.ts).
  const [hostPlayer] = React.useState(() =>
    isDash(url) ? undefined : currentHost().player
  );
  const [fit] = useSetting(settings.video.fit);
  const [subtitleStyle] = useSetting(settings.subtitle.style);
  const source = React.useMemo(() => sourceOf(url), [url]);
  const player = usePlayer(hostPlayer ?? videoEngine(video), {
    client,
    item: props.item,
    url,
    source,
    startMs: 0,
    onEnded: props.onBack,
    prefs,
    subtitleStyle,
  });
  return (
    <div
      data-page="player"
      data-name="trailer"
      className={cn('fixed inset-0', !hostPlayer && 'bg-black')}
    >
      {hostPlayer ? (
        <Cover item={props.item} hidden={player.state.started} />
      ) : (
        <video
          ref={video}
          data-ui="video"
          className={cn('h-full w-full', OBJECT_FIT[fit])}
          autoPlay
          playsInline
        />
      )}
      <Controls {...props} player={player} />
    </div>
  );
}

/** The embed draws its own controls, so only a bar of the page's sits above it. */
function EmbeddedTrailer({
  item,
  trailer,
  id,
  onBack,
  onPrevious,
  onNext,
  several,
}: TrailerProps & { id: string }) {
  useAction('back', onBack);
  const button = (
    name: string,
    label: string,
    icon: React.ReactElement,
    onClick?: () => void
  ) => (
    <IconButton
      data-name={name}
      intent="gray-subtle"
      className="rounded-full"
      icon={icon}
      aria-label={label}
      disabled={!onClick}
      onClick={onClick}
    />
  );
  return (
    <div
      data-page="player"
      data-name="trailer"
      className="fixed inset-0 flex flex-col bg-black"
    >
      <div
        data-ui="trailer-bar"
        className="flex items-center gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
      >
        {button(
          'exit',
          t`Back`,
          <LuArrowLeft className="rtl:-scale-x-100" />,
          onBack
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{item.Name}</p>
          <p className="truncate text-sm text-gray-300">{trailer.name}</p>
        </div>
        {several && (
          <>
            {button(
              'previous',
              t`Previous trailer`,
              <LuSkipBack />,
              onPrevious
            )}
            {button('next', t`Next trailer`, <LuSkipForward />, onNext)}
          </>
        )}
      </div>
      <iframe
        data-ui="trailer-embed"
        title={trailer.name}
        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className="min-h-0 w-full flex-1 border-0"
      />
    </div>
  );
}

function TrailerFailure({
  message,
  external,
  onBack,
}: {
  message: string;
  external?: string;
  onBack(): void;
}) {
  useAction('back', onBack);
  return (
    <div
      data-ui="player-error"
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/90 p-6"
    >
      <div className="max-w-md space-y-4 text-center">
        <p className="text-lg font-semibold [overflow-wrap:anywhere]">
          {message}
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            intent={external ? 'gray-outline' : 'white'}
            className="rounded-full"
            leftIcon={<BiArrowBack className="rtl:-scale-x-100" />}
            autoFocus={!external}
            onClick={onBack}
          >
            <Trans>Back</Trans>
          </Button>
          {external && (
            <Button
              intent="white"
              className="rounded-full"
              leftIcon={<BiLinkExternal />}
              autoFocus
              onClick={() => window.open(external, '_blank', 'noopener')}
            >
              <Trans>Open its page</Trans>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
