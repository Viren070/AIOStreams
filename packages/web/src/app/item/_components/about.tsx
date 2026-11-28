import React from 'react';
import { t } from '@lingui/core/macro';
import { Badge } from '@aiostreams/ui/badge';
import { Drawer } from '@aiostreams/ui/drawer';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { jobLabel } from '@/components/media/people';
import { useRestoreFocus } from '@/lib/input/restore-focus';
import { detailRows } from './details';
import { useItem } from '@/lib/jellyfin/queries';
import { episodeCode } from '@/lib/format';

/**
 * Its first frame takes a TV a good part of a second to draw, which a slide
 * started with it spends unseen; it starts once that frame is up.
 */
function startOnceDrawn(panel: HTMLElement | null | undefined) {
  if (!panel) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => panel.setAttribute('data-drawn', ''))
  );
}

/** The crew named in full here, in this order. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's person kinds
const CREW = ['Director', 'Creator', 'Writer', 'Composer'];

/**
 * All about a title, from the right: its overview in full and the facts the
 * page has no room for. On a TV it scrolls a step with each press.
 */
export function TitleAbout({
  item: listed,
  meta,
  open,
  onOpenChange,
}: {
  item: BaseItemDto;
  /** The page's own line of year, rating and length. */
  meta: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // An episode from a list leaves out its crew and more, which its own details hold.
  const fetched = useItem(open ? (listed.Id ?? '') : '').data;
  // Kept as it slides out, so its rows don't empty on the way.
  const last = React.useRef(fetched);
  if (fetched) last.current = fetched;
  const item =
    fetched ??
    (last.current?.Id === listed.Id ? last.current : undefined) ??
    listed;
  const body = React.useRef<HTMLDivElement>(null);
  // Opened with no trigger of its own, it hands focus back to where it was.
  const restoreFocus = useRestoreFocus(open);
  const crew = CREW.map((kind) => {
    const names = (item.People ?? [])
      .filter((person) => person.Type === kind && person.Name)
      .map((person) => person.Name);
    return [kind, jobLabel(kind), [...new Set(names)].join(', ')] as const;
  }).filter(([, , names]) => !!names);
  const rows = [...crew, ...detailRows(item)];
  const original =
    item.OriginalTitle && item.OriginalTitle !== item.Name
      ? item.OriginalTitle
      : null;
  return (
    <Drawer
      data-ui="dialog"
      data-name="title-about"
      open={open}
      onOpenChange={onOpenChange}
      // Focus in the text, so up and down scroll it.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        body.current?.focus();
        startOnceDrawn(body.current?.closest<HTMLElement>('.title-about'));
      }}
      onCloseAutoFocus={restoreFocus}
      title={item.Name ?? ''}
      headerClass="sr-only"
      side="right"
      size="lg"
      overlayClass="title-about-overlay"
      contentClass="title-about flex flex-col gap-0 overflow-hidden p-0"
    >
      <div
        data-ui="title-about-body"
        className="min-h-0 flex-1 overflow-y-auto px-8 pb-12 pt-10"
      >
        <div
          ref={body}
          tabIndex={-1}
          data-focus="own"
          className="space-y-6 outline-none"
        >
          <div className="space-y-2">
            {item.Type === 'Episode' && (
              <p className="text-[--muted]">
                {[
                  item.SeriesName,
                  episodeCode(item.ParentIndexNumber, item.IndexNumber),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            <h2 className="text-3xl font-semibold leading-tight">
              {item.Name}
            </h2>
            {original && <p className="text-[--muted]">{original}</p>}
            {item.Taglines?.[0] && (
              <p className="text-lg italic text-gray-300">{item.Taglines[0]}</p>
            )}
          </div>
          {meta}
          {!!item.Genres?.length && (
            <div className="flex flex-wrap gap-1.5">
              {item.Genres.map((genre) => (
                <Badge key={genre} intent="white" size="md">
                  {genre}
                </Badge>
              ))}
            </div>
          )}
          {item.Overview && (
            <p className="select-text whitespace-pre-line text-lg leading-relaxed text-gray-200">
              {item.Overview}
            </p>
          )}
          {!!rows.length && (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              {rows.map(([name, label, value]) => (
                <div key={name} data-ui="item-detail" data-name={name}>
                  <dt className="text-xs uppercase tracking-wide text-[--muted]">
                    {label}
                  </dt>
                  <dd className="mt-1 text-base">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </Drawer>
  );
}
