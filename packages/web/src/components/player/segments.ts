import React from 'react';
import { ticksToMs } from '../../lib/format';
import { settings, useSetting, type SegmentType } from '../../lib/settings';
import { useLatest } from '../../lib/use-latest';
import type { PlayerController } from '../../lib/playback/controller';
import type { MediaSegmentDto } from '../../lib/types';
import { usePlayhead } from '../../lib/playback/playhead';

/** How long the skip button stays once its segment starts, with the controls hidden. */
const SKIP_BUTTON_MS = 8000;

const SEGMENT_NAME: Record<string, string> = {
  Intro: 'intro',
  Recap: 'recap',
  Outro: 'credits',
  Preview: 'preview',
  Commercial: 'ad',
};

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
  SEGMENT_NAME[s.type] ? `Skip ${SEGMENT_NAME[s.type]}` : 'Skip';

/** `fresh` is set for the first few seconds of the offered segment. */
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
  const [actions] = useSetting(settings.segmentActions);
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
  const actionOf = (s: Segment) => actions[s.type as SegmentType] ?? 'ask';
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
    latest.current.seek(autoSkip.endMs);
    notice(`Skipped ${SEGMENT_NAME[autoSkip.type] ?? 'segment'}`);
  }, [autoSkip, started, offeringNext, notice, latest]);

  const [fresh, setFresh] = React.useState(false);
  const offeredId = offered && segmentId(offered);
  React.useEffect(() => {
    if (!offeredId) return;
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), SKIP_BUTTON_MS);
    return () => clearTimeout(timer);
  }, [offeredId]);

  const segment = offeringNext ? undefined : offered;
  return {
    segments,
    segment,
    fresh,
    skip: segment ? () => latest.current.seek(segment.endMs) : undefined,
  };
}
