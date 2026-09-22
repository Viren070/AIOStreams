import React from 'react';
import { BiInfoCircle } from 'react-icons/bi';
import { IconButton } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Popover } from '@/components/ui/popover';
import { useMediaQuery } from '@/hooks/media-query';

function Banner({ image }: { image: string | null }) {
  if (!image) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden"
    >
      <img
        src={image}
        alt=""
        className="h-full w-full object-cover opacity-30"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[--paper] to-transparent" />
    </div>
  );
}

export function EpisodeInfo({
  title,
  line,
  overview,
  image,
}: {
  title: string;
  line?: React.ReactNode;
  overview: string | null | undefined;
  image: string | null;
}) {
  const wide = useMediaQuery('(min-width: 1024px)');
  if (!overview) return null;
  const trigger = (
    <IconButton
      size="sm"
      intent="gray-subtle"
      className="rounded-full"
      icon={<BiInfoCircle />}
      aria-label="Episode details"
    />
  );
  const synopsis = (
    <p className="whitespace-pre-line text-sm text-gray-300">{overview}</p>
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
          {synopsis}
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
      <div className="relative z-[1]">{synopsis}</div>
    </Modal>
  );
}
