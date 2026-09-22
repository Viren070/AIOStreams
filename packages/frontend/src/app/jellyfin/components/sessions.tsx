import { Badge } from '@/components/ui/badge';
import { useSession } from '../lib/session';
import { landscapeUrl } from '../lib/images';
import { clock, itemTitle, ticksToMs } from '../lib/format';
import { href, itemPath } from '../lib/paths';
import { MediaRow } from './media-row';
import { WideCard } from './cards';
import type { SessionInfoDto } from '../lib/types';

/** What is playing right now; only the configuration's own user is sent any. */
export function SessionsRow({ sessions }: { sessions: SessionInfoDto[] }) {
  const playing = sessions.filter((s) => s.NowPlayingItem);
  if (!playing.length) return null;
  return (
    <MediaRow title="Now playing" shape="wide">
      {playing.map((s) => (
        <SessionCard key={s.Id} session={s} />
      ))}
    </MediaRow>
  );
}

function SessionCard({ session }: { session: SessionInfoDto }) {
  const { client } = useSession();
  const item = session.NowPlayingItem!;
  const position = ticksToMs(session.PlayState?.PositionTicks);
  const runtime = ticksToMs(item.RunTimeTicks);
  const paused = session.PlayState?.IsPaused;
  return (
    <WideCard
      href={href(itemPath(item))}
      image={landscapeUrl(client, item, { maxWidth: 640 })}
      title={itemTitle(item)}
      subtitle={[session.UserName, session.DeviceName || session.Client]
        .filter(Boolean)
        .join(' · ')}
      meta={
        runtime ? `${clock(position)} / ${clock(runtime)}` : clock(position)
      }
      progress={runtime ? (position / runtime) * 100 : null}
      badge={
        <Badge intent={paused ? 'gray-solid' : 'primary-solid'} size="sm">
          {paused ? 'Paused' : 'Playing'}
        </Badge>
      }
    />
  );
}
