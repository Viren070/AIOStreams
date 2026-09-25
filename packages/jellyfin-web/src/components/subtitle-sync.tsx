import React from 'react';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import { clock } from '../lib/format';
import { delayForLine, type SubtitleLine } from '../lib/subtitle-lines';

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
