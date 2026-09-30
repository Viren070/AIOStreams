import React from 'react';
import { BiSolidStar, BiSolidStarHalf, BiStar } from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Popover } from '@aiostreams/ui/popover';
import { useSetRating } from '../lib/queries';
import type { BaseItemDto } from '../lib/types';

const STARS = 10;
const STEP = 0.5;

function formatRating(value: number): string {
  return String(Number(value.toFixed(1)));
}

function Star({ fill }: { fill: number }) {
  if (fill >= 1) return <BiSolidStar className="text-brand-500" />;
  if (fill >= STEP) return <BiSolidStarHalf className="text-brand-500" />;
  return <BiStar className="text-white/30" />;
}

/** Ten stars in half steps, on the 0 to 10 scale Jellyfin keeps. */
export function RatingButton({
  item,
  label = 'Rate',
  inline,
}: {
  item: BaseItemDto;
  label?: string;
  inline?: boolean;
}) {
  const setRating = useSetRating();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<number | null>(null);
  const rating = item.UserData?.Rating ?? null;
  const shown = draft ?? rating ?? 0;

  const choose = (value: number | null) => {
    setRating.mutate({ itemId: item.Id!, rating: value });
    setDraft(null);
    setOpen(false);
  };
  const valueAt = (e: React.PointerEvent | React.MouseEvent, star: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return star + (e.clientX - rect.left < rect.width / 2 ? STEP : 1);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? STEP
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -STEP
          : 0;
    if (step) {
      e.preventDefault();
      setDraft(Math.min(STARS, Math.max(STEP, shown + step)));
    } else if ((e.key === 'Enter' || e.key === ' ') && draft != null) {
      e.preventDefault();
      choose(draft);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setDraft(null);
      }}
      align="start"
      data-ui="rating-picker"
      className="w-auto rounded-xl bg-[--paper] p-3"
      trigger={
        inline ? (
          <button
            type="button"
            data-ui="inline-rating"
            data-active={rating != null || undefined}
            className="inline-flex items-center gap-1 transition-colors hover:text-white data-[active]:text-white"
          >
            {rating != null ? (
              <BiSolidStar className="text-brand-500" />
            ) : (
              <BiStar />
            )}
            {rating != null ? formatRating(rating) : label}
          </button>
        ) : rating != null ? (
          <Button
            data-ui="item-action"
            data-name="rating"
            data-active
            intent="primary-subtle"
            className="rounded-full px-3"
            leftIcon={<BiSolidStar className="text-lg" />}
            loading={setRating.isPending}
          >
            {formatRating(rating)}
          </Button>
        ) : (
          <IconButton
            data-ui="item-action"
            data-name="rating"
            intent="gray-subtle"
            className="rounded-full"
            icon={<BiStar />}
            aria-label={label}
            loading={setRating.isPending}
          />
        )
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-semibold">
          {draft != null || rating != null
            ? `${formatRating(shown)} / 10`
            : 'Your rating'}
        </p>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Your rating"
          aria-valuemin={0}
          aria-valuemax={STARS}
          aria-valuenow={shown}
          className="flex rounded-md text-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          onKeyDown={onKey}
          onPointerLeave={() => setDraft(null)}
        >
          {Array.from({ length: STARS }, (_, star) => (
            <button
              key={star}
              type="button"
              tabIndex={-1}
              aria-hidden
              className="p-0.5"
              onPointerMove={(e) => setDraft(valueAt(e, star))}
              onClick={(e) => choose(valueAt(e, star))}
            >
              <Star fill={shown - star} />
            </button>
          ))}
        </div>
        {rating != null && (
          <Button
            size="sm"
            intent="gray-subtle"
            className="w-full rounded-full"
            onClick={() => choose(null)}
          >
            Clear rating
          </Button>
        )}
      </div>
    </Popover>
  );
}
