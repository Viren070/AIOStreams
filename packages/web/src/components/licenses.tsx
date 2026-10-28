import { useQuery } from '@tanstack/react-query';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { Button } from '@aiostreams/ui/button';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { useRestoreFocus } from '../lib/input';
import { ScrollRoot, useInView } from '../lib/use-in-view';
import { loadLicenses, type Library } from '../lib/licenses';
import { SettingsRow } from './settings-card';

/** Rows rendered at a time, as a TV draws a few hundred slowly. */
const PAGE = 40;

const key = (l: Library) => `${l.name}@${l.version ?? ''}`;

/** A commit pin would fill the line. */
const shortVersion = (v?: string) =>
  v && /^[0-9a-f]{40}$/.test(v) ? v.slice(0, 10) : v;

const details = (l: Library) =>
  [shortVersion(l.version), l.licence].filter(Boolean).join(' · ');

export function LicensesSetting() {
  const [open, setOpen] = React.useState(false);
  const restoreFocus = useRestoreFocus(open);
  return (
    <>
      <SettingsRow
        label={t`Licences`}
        help={t`The open-source software in this app, and the licence of each.`}
      >
        <Button
          intent="gray-outline"
          className="w-full rounded-full sm:w-auto"
          onClick={() => setOpen(true)}
        >
          <Trans>View</Trans>
        </Button>
      </SettingsRow>
      <Modal
        data-ui="dialog"
        data-name="licenses"
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={restoreFocus}
        title={t`Licences`}
        contentClass="max-w-2xl"
      >
        {open && <Licenses />}
      </Modal>
    </>
  );
}

function Licenses() {
  const list = useQuery({
    queryKey: ['licenses'],
    queryFn: loadLicenses,
    staleTime: Infinity,
  });
  const [query, setQuery] = React.useState('');
  const words = React.useDeferredValue(query.trim().toLowerCase());
  const [shown, setShown] = React.useState<Library | null>(null);
  const [last, setLast] = React.useState<string | null>(null);
  if (list.isPending)
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner />
      </div>
    );
  if (list.isError)
    return (
      <p className="text-sm text-[--muted]">
        <Trans>The licences couldn't be loaded.</Trans>
      </p>
    );
  if (shown)
    return (
      <LicenseText
        library={shown}
        texts={list.data.texts}
        onBack={() => {
          setLast(key(shown));
          setShown(null);
        }}
      />
    );
  const libraries = words
    ? list.data.libraries.filter((l) => l.name.toLowerCase().includes(words))
    : list.data.libraries;
  return (
    <>
      <TextInput
        aria-label={t`Search`}
        placeholder={t`Search`}
        value={query}
        onValueChange={setQuery}
      />
      <LibraryList
        key={words}
        libraries={libraries}
        last={last}
        onOpen={setShown}
      />
    </>
  );
}

function LibraryList({
  libraries,
  last,
  onOpen,
}: {
  libraries: Library[];
  /** The entry to focus again, coming back from its text. */
  last: string | null;
  onOpen: (library: Library) => void;
}) {
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  // Enough rows to reach the one to focus again.
  const [limit, setLimit] = React.useState(() =>
    Math.max(PAGE, libraries.findIndex((l) => key(l) === last) + PAGE)
  );
  React.useEffect(() => {
    if (!last) return;
    box
      ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(last)}"]`)
      ?.focus();
  }, [box, last]);
  if (!libraries.length)
    return (
      <p className="text-sm text-[--muted]">
        <Trans>Nothing matches.</Trans>
      </p>
    );
  return (
    <div
      ref={setBox}
      data-nav-group
      className="-mx-2 max-h-[55vh] space-y-1 overflow-y-auto"
    >
      <ScrollRoot.Provider value={box}>
        {libraries.slice(0, limit).map((library, i) => (
          <button
            key={key(library)}
            type="button"
            data-ui="license-entry"
            data-key={key(library)}
            data-focus="own"
            data-nav-start={i === 0 || undefined}
            onClick={() => onOpen(library)}
            className="block w-full rounded-xl p-2 text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring] [[data-tv]_&]:focus-visible:ring-[3px]"
          >
            <span className="block truncate text-sm font-semibold">
              {library.name}
            </span>
            <span className="block truncate text-xs text-[--muted]">
              {details(library)}
            </span>
          </button>
        ))}
        {limit < libraries.length && (
          <More key={limit} onNear={() => setLimit(limit + PAGE)} />
        )}
      </ScrollRoot.Provider>
    </div>
  );
}

function More({ onNear }: { onNear: () => void }) {
  const ref = useInView<HTMLDivElement>(onNear, '300px');
  return <div ref={ref} className="h-px" />;
}

function LicenseText({
  library,
  texts,
  onBack,
}: {
  library: Library;
  texts: string[];
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Button
          intent="gray-subtle"
          size="sm"
          className="flex-none rounded-full"
          autoFocus
          onClick={onBack}
        >
          <Trans>Back</Trans>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{library.name}</p>
          <p className="truncate text-xs text-[--muted]">{details(library)}</p>
        </div>
        {library.url && (
          <Button
            intent="gray-outline"
            size="sm"
            className="flex-none rounded-full"
            onClick={() => window.open(library.url, '_blank', 'noopener')}
          >
            <Trans>Visit</Trans>
          </Button>
        )}
      </div>
      {/* Focusable, so a remote's arrows scroll it. */}
      <div
        tabIndex={0}
        data-ui="license-text"
        className="max-h-[55vh] space-y-4 overflow-y-auto rounded-xl bg-black/30 p-3 outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
      >
        {library.texts.length ? (
          library.texts.map((i) => (
            <pre
              key={i}
              className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-300"
            >
              {texts[i]}
            </pre>
          ))
        ) : (
          <p className="text-sm text-[--muted]">
            <Trans>It came with no licence text.</Trans>
          </p>
        )}
      </div>
    </>
  );
}
