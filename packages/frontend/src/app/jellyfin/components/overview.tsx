import React from 'react';
import { Modal } from '@/components/ui/modal';
import { Popover } from '@/components/ui/popover';
import { useMediaQuery } from '@/hooks/media-query';
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
