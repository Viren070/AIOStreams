import React from 'react';
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
      className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden"
    >
      <div className="absolute inset-0 opacity-30">
        <Artwork src={image} alt="" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-[--paper] to-transparent" />
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
}: OverviewDetails & { trigger: React.ReactElement }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const text = (
    <p className="select-text whitespace-pre-line text-sm text-gray-300">
      {overview}
    </p>
  );

  if (wide) {
    return (
      <Popover
        trigger={trigger}
        align="end"
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
      trigger={trigger}
      title={title}
      description={line}
      contentClass="overflow-hidden"
      headerClass="relative z-[1] pt-12 text-left"
      closeClass="z-[2]"
    >
      <Banner image={image} />
      <div className="relative z-[1]">{text}</div>
    </Modal>
  );
}

export function Overview({
  clampClass,
  className,
  ...details
}: OverviewDetails & { clampClass: string; className?: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null);
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
  // A stretched flex item's height is definite, so the spacer can float More to the last line.
  return (
    <div className={cn('flex', className)}>
      <p
        ref={ref}
        className={cn(
          'min-w-0 select-text whitespace-pre-line before:float-right before:h-[calc(100%-1lh)]',
          clampClass
        )}
      >
        {clipped && (
          <OverviewInfo
            {...details}
            trigger={
              <button
                type="button"
                className="relative z-[1] clear-both float-right rounded pl-5 font-medium text-[--muted] outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
              >
                More
              </button>
            }
          />
        )}
        {details.overview}
      </p>
    </div>
  );
}
