import React from 'react';
import { LuEar, LuEye, LuX } from 'react-icons/lu';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import { clock } from '../lib/format';
import {
  delayForLine,
  delayForTaps,
  delayLabel,
  type SubtitleLine,
} from '../lib/subtitle-lines';

type Tap = 'heard' | 'saw';

const TAP_KEYS: Record<string, Tap> = { h: 'heard', s: 'saw' };

/**
 * Two taps, in either order: when a line is heard and when its subtitle shows.
 * Their gap is the correction, so embedded subtitles, whose text is unknown, sync too.
 */
export function SyncByEar({
  delayMs,
  now,
  onApply,
  onClose,
}: {
  delayMs: number;
  /** The playback position at this moment. */
  now(): number;
  onApply(delayMs: number): void;
  onClose(): void;
}) {
  const [first, setFirst] = React.useState<{ tap: Tap; atMs: number } | null>(
    null
  );
  const [status, setStatus] = React.useState<string | null>(null);

  const tap = (kind: Tap) => {
    const atMs = now();
    if (!first || first.tap === kind) {
      setFirst({ tap: kind, atMs });
      setStatus(
        kind === 'heard'
          ? 'Now tap Saw when that line shows.'
          : 'Now tap Heard when that line is spoken.'
      );
      return;
    }
    setFirst(null);
    const heard = kind === 'heard' ? atMs : first.atMs;
    const saw = kind === 'saw' ? atMs : first.atMs;
    const next = delayForTaps(delayMs, heard, saw);
    if (next === null) {
      setStatus('Those were too far apart to be one line. Try another line.');
      return;
    }
    onApply(next);
    setStatus(
      `Subtitles set to ${delayLabel(next).toLowerCase()}. Another line refines it.`
    );
  };
  const latestTap = React.useRef(tap);
  latestTap.current = tap;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'Escape') onClose();
      const kind = TAP_KEYS[e.key.toLowerCase()];
      if (!kind) return;
      e.preventDefault();
      latestTap.current(kind);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const button = (
    kind: Tap,
    label: string,
    key: string,
    icon: React.ReactNode
  ) => (
    <Button
      intent={first?.tap === kind ? 'white' : 'gray-subtle'}
      rounded
      leftIcon={icon}
      onClick={() => tap(kind)}
    >
      {label}
      <kbd className="ml-2 hidden rounded border border-white/30 px-1 text-xs opacity-60 sm:inline">
        {key}
      </kbd>
    </Button>
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-20 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-black/80 p-4 shadow-lg backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">Sync by ear</p>
            <p className="text-sm text-gray-300">
              {status ??
                'Tap when you hear a line and when its subtitle shows, in either order.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Done"
            onClick={onClose}
            className="flex-none rounded-full p-1 text-gray-300 hover:bg-white/10 hover:text-white"
          >
            <LuX className="size-5" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {button('heard', 'Heard', 'H', <LuEar />)}
          {button('saw', 'Saw', 'S', <LuEye />)}
        </div>
        <p className="mt-2 text-xs tabular-nums text-gray-400">
          Now: {delayLabel(delayMs)}
        </p>
      </div>
    </div>
  );
}

const AROUND = 25;

/**
 * Lines around the moment a line was heard; picking the one heard sets the
 * delay that shows it then.
 */
export function SyncToLine({
  heardAtMs,
  delayMs,
  load,
  onPick,
  onClose,
}: {
  heardAtMs: number;
  delayMs: number;
  load(): Promise<SubtitleLine[] | null>;
  onPick(delayMs: number): void;
  onClose(): void;
}) {
  const [lines, setLines] = React.useState<SubtitleLine[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const nearest = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    load().then(
      (found) => (found?.length ? setLines(found) : setFailed(true)),
      () => setFailed(true)
    );
  }, [load]);

  // Where the heard line sits in the file, with the current delay undone.
  const expectedMs = heardAtMs - delayMs;
  const closest = lines
    ? lines.reduce(
        (best, line, i) =>
          Math.abs(line.startMs - expectedMs) <
          Math.abs(lines[best].startMs - expectedMs)
            ? i
            : best,
        0
      )
    : 0;
  const term = search.trim().toLowerCase();
  const shown = lines
    ? term
      ? lines.filter((l) => l.text.toLowerCase().includes(term))
      : lines.slice(Math.max(0, closest - AROUND), closest + AROUND)
    : [];

  React.useEffect(() => {
    if (!term) nearest.current?.scrollIntoView({ block: 'center' });
  }, [lines, term]);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Sync to a line"
      description={`Pick the line you heard at ${clock(heardAtMs)}.`}
      contentClass="max-w-lg"
    >
      {failed ? (
        <p className="text-sm text-[--muted]">
          These subtitles&apos; lines could not be read.
        </p>
      ) : !lines ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-3">
          <TextInput
            placeholder="Search the lines"
            value={search}
            onValueChange={setSearch}
          />
          <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {shown.map((line) => {
              const isClosest = !term && line === lines[closest];
              return (
                <button
                  key={`${line.startMs}-${line.text}`}
                  ref={isClosest ? nearest : undefined}
                  type="button"
                  onClick={() => onPick(delayForLine(heardAtMs, line))}
                  className={cn(
                    'flex w-full gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/10',
                    isClosest && 'bg-white/5'
                  )}
                >
                  <span className="flex-none tabular-nums text-[--muted]">
                    {clock(line.startMs)}
                  </span>
                  <span>{line.text}</span>
                </button>
              );
            })}
            {!shown.length && (
              <p className="px-3 py-2 text-sm text-[--muted]">
                No line matches.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
