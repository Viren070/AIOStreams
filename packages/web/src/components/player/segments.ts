import { t } from '@lingui/core/macro';
import React from 'react';
import { ticksToMs } from '../../lib/format';
import { settings, useSetting, type SegmentType } from '../../lib/settings';
import { useLatest } from '../../lib/use-latest';
import type { PlayerController } from '../../lib/playback/controller';
import type { PlannedSkip } from '../../lib/playback/engine';
import type { MediaSegmentDto } from '../../lib/types';
import { usePlayhead } from '../../lib/playback/playhead';
import { endsEpisode } from './next-episode';

/** How long the skip button stays once its segment starts, with the controls hidden. */
const SKIP_BUTTON_MS = 8000;

/** Segment ends are scene cuts, where encoders put keyframes. */
const SKIP_SNAP_MS = 1000;

export interface Segment {
  type: string;
  startMs: number;
  endMs: number;
}

const segmentId = (s: Segment) => `${s.type}:${s.startMs}`;

function segmentsOf(items: MediaSegmentDto[] | null | undefined): Segment[] {
  return (items ?? [])
    .map((s) => ({
      type: String(s.Type),
      startMs: ticksToMs(s.StartTicks),
      endMs: ticksToMs(s.EndTicks),
    }))
    .filter((s) => s.endMs > s.startMs);
}

export const skipLabel = (s: Segment) =>
  (
    ({
      Intro: t`Skip intro`,
      Recap: t`Skip recap`,
      Outro: t`Skip credits`,
      Preview: t`Skip preview`,
      Commercial: t`Skip ad`,
    }) as Record<string, string>
  )[s.type] ?? t`Skip`;

const skippedNotice = (s: Segment) =>
  (
    ({
      Intro: t`Skipped intro`,
      Recap: t`Skipped recap`,
      Outro: t`Skipped credits`,
      Preview: t`Skipped preview`,
      Commercial: t`Skipped ad`,
    }) as Record<string, string>
  )[s.type] ?? t`Skipped segment`;

/**
 * `fresh` is set for the first few seconds of the offered segment. The player
 * is told which segments it will skip and which it may, so it leaves out the
 * first and fetches past the others early.
 */
export function useSegmentSkip({
  items,
  player,
  offeringNext,
  notice,
}: {
  items: MediaSegmentDto[] | null | undefined;
  player: PlayerController;
  /** The next episode's card covers skipping the credits. */
  offeringNext: boolean;
  notice(text: string): void;
}) {
  const segments = React.useMemo(() => segmentsOf(items), [items]);
  const [actions] = useSetting(settings.playback.segmentActions);
  const { started } = player.state;
  const latest = useLatest(player);
  const insideIds = usePlayhead(player.playhead, ({ positionMs }) =>
    segments
      .filter((s) => positionMs >= s.startMs && positionMs < s.endMs - 1000)
      .map(segmentId)
      .join('|')
  );
  const inside = segments.filter((s) =>
    insideIds.split('|').includes(segmentId(s))
  );
  // With others watching, a skip is everyone's, so it waits to be asked for.
  const actionOf = (s: Segment) => {
    const action = actions[s.type as SegmentType] ?? 'ask';
    return action === 'skip' && player.shared ? 'ask' : action;
  };
  // Each segment skips once; seeking back into one offers the button instead.
  const skipped = React.useRef(new Set<string>());
  const offered = inside.find(
    (s) =>
      actionOf(s) === 'ask' ||
      (actionOf(s) === 'skip' && skipped.current.has(segmentId(s)))
  );
  const autoSkip = inside.find(
    (s) => actionOf(s) === 'skip' && !skipped.current.has(segmentId(s))
  );
  React.useEffect(() => {
    if (!autoSkip || !started) return;
    skipped.current.add(segmentId(autoSkip));
    if (offeringNext) return;
    latest.current.seek(autoSkip.endMs, SKIP_SNAP_MS);
    notice(skippedNotice(autoSkip));
  }, [autoSkip, started, offeringNext, notice, latest]);

  const [fresh, setFresh] = React.useState(false);
  const offeredId = offered && segmentId(offered);
  React.useEffect(() => {
    if (!offeredId) return;
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), SKIP_BUTTON_MS);
    return () => clearTimeout(timer);
  }, [offeredId]);

  const { loaded, durationMs } = player.state;
  const planned: PlannedSkip[] = segments
    .filter((s) => actionOf(s) !== 'none' && !endsEpisode(durationMs, s.endMs))
    .map((s) => ({
      startMs: s.startMs,
      endMs: s.endMs,
      auto: actionOf(s) === 'skip',
    }));
  const latestPlanned = useLatest(planned);
  const plannedKey = planned
    .map((s) => `${s.startMs}-${s.endMs}-${s.auto}`)
    .join('|');
  React.useEffect(() => {
    if (loaded) latest.current.skipAhead?.(latestPlanned.current);
  }, [plannedKey, loaded, latest, latestPlanned]);

  const segment = offeringNext ? undefined : offered;
  return {
    segments,
    segment,
    fresh,
    skip: segment
      ? () => latest.current.seek(segment.endMs, SKIP_SNAP_MS)
      : undefined,
  };
}
