import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';

export interface TocEntry {
  id: string;
  title: string;
}

/** Past a group's scroll margin, where a jump to it stops. */
const REACHED_PX = 160;

/** Read from the page, as editors show and hide groups. */
export function useToc(
  root: React.RefObject<HTMLElement | null>,
  key: string
): TocEntry[] {
  const [entries, setEntries] = React.useState<TocEntry[]>([]);
  // Before paint: the contents change the page's width, so a late read reflows it.
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const readNow = () => {
      const next = [...el.querySelectorAll<HTMLElement>('[data-group]')].map(
        (group) => ({ id: group.id, title: group.dataset.group ?? '' })
      );
      setEntries((prev) =>
        prev.length === next.length &&
        prev.every((e, i) => e.id === next[i].id && e.title === next[i].title)
          ? prev
          : next
      );
    };
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(readNow);
    };
    readNow();
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, key]);
  return entries;
}

function useActive(entries: TocEntry[]) {
  const [active, setActive] = React.useState<string | null>(null);
  // A group near the end can't reach the line, so a pick holds until the user scrolls.
  const picked = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!entries.length) return;
    const update = () => {
      if (picked.current) return setActive(picked.current);
      const bottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4;
      let current = entries[0].id;
      for (const entry of entries) {
        const top = document
          .getElementById(entry.id)
          ?.getBoundingClientRect().top;
        if (top !== undefined && top <= REACHED_PX) current = entry.id;
      }
      setActive(bottom ? entries[entries.length - 1].id : current);
    };
    const release = () => {
      picked.current = null;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    for (const event of ['wheel', 'touchstart', 'keydown'] as const) {
      window.addEventListener(event, release, { passive: true });
    }
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      for (const event of ['wheel', 'touchstart', 'keydown'] as const) {
        window.removeEventListener(event, release);
      }
    };
  }, [entries]);
  const pick = (id: string) => {
    picked.current = id;
    setActive(id);
  };
  return [active, pick] as const;
}

export function PageToc({
  entries,
  layout,
}: {
  entries: TocEntry[];
  layout: 'column' | 'row';
}) {
  const [active, pick] = useActive(entries);
  const nav = React.useRef<HTMLElement>(null);
  const go = (id: string) => {
    pick(id);
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // Not scrollIntoView: it also scrolls the window, cutting short a jump in progress.
  React.useEffect(() => {
    const row = nav.current;
    if (layout !== 'row' || !row) return;
    const tab = row.querySelector<HTMLElement>('[aria-current]');
    if (!tab) return;
    const left = tab.offsetLeft - row.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < row.scrollLeft || right > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: left - 16, behavior: 'smooth' });
    }
  }, [active, layout]);
  return (
    <nav
      ref={nav}
      aria-label="On this page"
      className={cn(
        layout === 'row'
          ? 'flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'space-y-0.5 border-l border-[--border]'
      )}
    >
      {layout === 'column' && (
        <p className="mb-2 pl-3 text-[11px] font-semibold uppercase tracking-wider text-[--muted]">
          On this page
        </p>
      )}
      {entries.map((entry) => {
        const current = entry.id === active;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => go(entry.id)}
            aria-current={current ? 'true' : undefined}
            className={cn(
              'text-left text-sm transition-colors focus-visible:outline-none',
              layout === 'row'
                ? cn(
                    'shrink-0 border-b-2 pb-2.5 pt-1 font-medium',
                    current
                      ? 'border-brand-400 text-white'
                      : 'border-transparent text-[--muted] hover:text-white'
                  )
                : cn(
                    '-ml-px block w-full border-l py-1 pl-3',
                    current
                      ? 'border-brand-400 text-white'
                      : 'border-transparent text-[--muted] hover:text-white'
                  )
            )}
          >
            {entry.title}
          </button>
        );
      })}
    </nav>
  );
}
