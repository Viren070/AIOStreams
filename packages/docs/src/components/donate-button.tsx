'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { SiKofi, SiGithubsponsors } from 'react-icons/si';
import { FaHeart, FaTimes } from 'react-icons/fa';

const KOFI_URL = 'https://ko-fi.com/viren070';
const SPONSORS_URL = 'https://github.com/sponsors/Viren070';

function DonateDialogContent() {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-[rgb(255_255_255_/_5%)] bg-fd-background p-6 shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-xl">
        <Dialog.Close className="absolute right-4 top-4 rounded-sm text-fd-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-fd-ring focus:ring-offset-2">
          <FaTimes className="size-4" />
          <span className="sr-only">Close</span>
        </Dialog.Close>

        <div className="flex flex-col items-center gap-4 text-center">
          <span className="text-4xl" aria-hidden="true">
            💖
          </span>
          <div>
            <Dialog.Title className="text-xl font-bold text-fd-foreground">
              Support AIOStreams
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-fd-muted-foreground max-w-xs">
              AIOStreams is a solo project built in my free time. If you find it
              useful, please consider supporting my work — it helps keep the
              project alive and improving!
            </Dialog.Description>
          </div>

          <div className="flex flex-col gap-3 w-full mt-2">
            <a
              href={KOFI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-fd-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-muted"
            >
              <SiKofi className="size-4 text-[#FF5E5B]" />
              Ko-fi
            </a>
            <a
              href={SPONSORS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-fd-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-muted"
            >
              <SiGithubsponsors className="size-4 text-[#EA4AAA]" />
              GitHub Sponsors
            </a>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

/**
 * Full donate button with text label — used in home page CTA.
 */
export function DonateButton({ className }: { className?: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className={className}>
          <FaHeart />
          Donate
        </button>
      </Dialog.Trigger>
      <DonateDialogContent />
    </Dialog.Root>
  );
}

/**
 * Icon-only donate button — used in the navbar / sidebar via type: 'custom' link.
 */
export function DonateIconButton() {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
        aria-label="Donate"
      >
        <FaHeart />
      </Dialog.Trigger>
      <DonateDialogContent />
    </Dialog.Root>
  );
}
