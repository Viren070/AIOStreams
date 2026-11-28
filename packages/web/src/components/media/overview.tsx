import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { currentHost } from '@/lib/hosts';
import { Modal } from '@aiostreams/ui/modal';
import { Popover } from '@aiostreams/ui/popover';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { Artwork } from './cards';

function Banner({ image }: { image: string[] }) {
  if (!image.length) return null;
  return (
    <div
      aria-hidden
      data-ui="overview-banner"
      className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden"
    >
      <div className="absolute inset-0 opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent)]">
        <Artwork src={image} alt="" />
      </div>
    </div>
  );
}

interface OverviewDetails {
  title: string;
  line?: React.ReactNode;
  overview: string | null | undefined;
  image: string[];
}

export function OverviewInfo({
  title,
  line,
  overview,
  image,
  trigger,
  open,
  onOpenChange,
}: OverviewDetails & {
  /** Without one, it opens with `open`, as a dialog. */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const text = (
    <p
      data-ui="overview-text"
      className="select-text whitespace-pre-line text-sm text-gray-300"
    >
      {overview}
    </p>
  );

  if (wide && trigger) {
    return (
      <Popover
        trigger={trigger}
        align="end"
        data-ui="overview-popover"
        className="relative max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[30rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-[--paper] p-0"
      >
        <Banner image={image} />
        <div className="relative space-y-3 p-4 pt-16">
          <div className="space-y-1">
            <p className="text-lg font-semibold leading-snug">{title}</p>
            {line && <p className="text-sm text-[--muted]">{line}</p>}
          </div>
          {text}
        </div>
      </Popover>
    );
  }
  return (
    <Modal
      data-ui="dialog"
      data-name="overview"
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={line}
      contentClass="overflow-hidden"
      headerClass="relative z-[1] pt-12 text-start"
      closeClass="z-[2]"
    >
      <Banner image={image} />
      <div className="relative z-[1]">{text}</div>
    </Modal>
  );
}

/** How much of `text` fits `lines` lines in `box` with "… More" after it. */
function fitWithMore(box: HTMLElement, text: string, lines: number): number {
  const most = lines * parseFloat(getComputedStyle(box).lineHeight) + 1;
  const more = document.createElement('span');
  more.className = 'font-semibold';
  more.textContent = t`More`;
  const fits = (n: number) => {
    box.textContent =
      n < text.length ? `${text.slice(0, n).trimEnd()}… ` : `${text} `;
    box.append(more);
    return box.offsetHeight <= most;
  };
  if (fits(text.length)) return text.length;
  let [low, high] = [0, text.length];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  // At a word's end, not inside one.
  const space = text.lastIndexOf(' ', low);
  return space > 0 ? space : low;
}

/**
 * A TV title's overview as one button: two lines at most, then More, after
 * an ellipsis where the text is cut, right after its last word.
 */
function PressedOverview({
  overview,
  onPress,
  className,
}: {
  overview: string;
  onPress: () => void;
  className?: string;
}) {
  const button = React.useRef<HTMLButtonElement>(null);
  const measure = React.useRef<HTMLSpanElement>(null);
  const [shown, setShown] = React.useState(overview.length);
  React.useLayoutEffect(() => {
    const box = measure.current;
    const el = button.current;
    if (!box || !el) return;
    // Not while hidden, where nothing has a width, which would fit it all.
    const fit = () => {
      if (el.offsetWidth) setShown(fitWithMore(box, overview, 2));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [overview]);
  const cut = shown < overview.length;
  return (
    // Lit as the actions are.
    <button
      ref={button}
      type="button"
      data-ui="overview"
      data-name="pressed"
      data-focus="own"
      onClick={onPress}
      className={cn(
        'relative block rounded-lg text-start outline-none -mx-2 px-2 py-1 focus-visible:bg-white focus-visible:text-black',
        className
      )}
    >
      <span className="block max-h-[2lh] overflow-hidden whitespace-pre-line">
        {cut ? `${overview.slice(0, shown).trimEnd()}… ` : `${overview} `}
        <span data-ui="overview-more" className="font-semibold">
          <Trans>More</Trans>
        </span>
      </span>
      {/* Laid out as the words are, to find how many fit. */}
      <span
        ref={measure}
        aria-hidden
        className="invisible absolute inset-x-2 top-1 block whitespace-pre-line"
      />
    </button>
  );
}

export const Overview = React.memo(function Overview({
  clampClass,
  className,
  onPress,
  ...details
}: OverviewDetails & {
  clampClass: string;
  className?: string;
  /**
   * On a TV, the text itself is the button: two lines at most, cut short with
   * an ellipsis, and OK opens what this shows.
   */
  onPress?: () => void;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const [clipped, setClipped] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [details.overview]);
  if (!details.overview) return null;
  if (onPress && currentHost().tv)
    return (
      <PressedOverview
        overview={details.overview}
        onPress={onPress}
        className={className}
      />
    );
  // A stretched flex item's height is definite, so the spacer can float More to the last line.
  // Clamped by height: WebKit lays out line-clamp's -webkit-box as a column and drops the floats.
  return (
    <div data-ui="overview" className={cn('flex', className)}>
      <p
        ref={ref as React.Ref<HTMLParagraphElement>}
        className={cn(
          'min-w-0 select-text overflow-hidden whitespace-pre-line before:float-right rtl:before:float-left before:h-[calc(100%-1lh)]',
          clampClass
        )}
      >
        {clipped && (
          <OverviewInfo
            {...details}
            trigger={
              <button
                type="button"
                data-ui="overview-more"
                data-focus="own"
                className="relative z-[1] clear-both float-right rtl:float-left ps-5 font-medium text-[--muted] transition-[color,box-shadow] hover:text-white focus-visible:text-white focus-visible:underline [[data-tv]_&]:ms-5 [[data-tv]_&]:rounded-full [[data-tv]_&]:px-2 [[data-tv]_&]:focus-visible:shadow-[inset_0_0_0_999px_rgb(255_255_255/0.2)] [[data-tv]_&]:focus-visible:no-underline"
              >
                <Trans>More</Trans>
              </button>
            }
          />
        )}
        {details.overview}
      </p>
    </div>
  );
});
