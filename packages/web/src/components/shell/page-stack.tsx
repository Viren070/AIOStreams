import React from 'react';
import { motion } from 'motion/react';
import {
  useRouter,
  useRouterState,
  type AnyRouter,
  type ParsedLocation,
} from '@tanstack/react-router';
import { cn } from '@aiostreams/ui/core/styling';
import { currentWash } from '@/lib/artwork/background';
import { pageOpening } from '@/lib/page-open';
import { PageSearch, PageShown } from '@/lib/page-shown';
import { PageScroll } from './page-scroll';

export type PageView = (match: {
  params: Record<string, string>;
  search: Record<string, string | undefined>;
}) => React.ReactElement;

/** Pages kept behind the open one, besides the last Home. */
const KEPT = 4;

const PAGE_FADE = {
  initial: { opacity: 0, top: 6 },
  animate: { opacity: 1, top: 0 },
  transition: { type: 'spring', damping: 28, stiffness: 260, mass: 0.7 },
} as const;

interface Entry {
  /** New for each page made; a replace on the same path keeps it. */
  id: number;
  index: number;
  key: string;
  pathname: string;
  searchStr: string;
  view: React.ReactElement;
  /** Pushed over the same page, which needs no entrance. */
  still: boolean;
}

let made = 0;
/** Each history entry's scroll and wash art as it was left, noted before the next page renders. */
const leftAt = new Map<string, { y: number; art?: string }>();

const keyOf = (location: ParsedLocation) =>
  location.state.__TSR_key ?? location.href;

function settle(
  stack: Entry[],
  location: ParsedLocation,
  router: AnyRouter
): Entry[] {
  const match = router.matchRoutes(location).at(-1);
  const view = match?.staticData.page;
  // The player, or no page: what was open stays.
  if (!match || !view) return stack;
  const key = keyOf(location);
  const index = location.state.__TSR_index ?? 0;
  const { pathname, searchStr } = location;
  const top = stack.at(-1);
  const returned = stack.find((e) => e.key === key);
  let next: Entry[];
  if (returned) next = stack.filter((e) => e.index < index || e === returned);
  else {
    const page = view({ params: match.params, search: match.search });
    if (top?.index === index && top.pathname === pathname)
      next = [...stack.slice(0, -1), { ...top, key, searchStr, view: page }];
    else
      next = [
        ...stack.filter((e) => e.index < index),
        {
          id: ++made,
          index,
          key,
          pathname,
          searchStr,
          view: page,
          still: top?.index === index - 1 && top.pathname === pathname,
        },
      ];
  }
  const open = next.at(-1)!;
  const home = next.filter((e) => e.pathname === '/' && e !== open).at(-1);
  next = next.filter(
    (e) => e === open || e === home || e.index >= open.index - KEPT
  );
  for (const k of leftAt.keys())
    if (!next.some((e) => e.key === k)) leftAt.delete(k);
  return next;
}

const pageName = (pathname: string) => pathname.split('/')[1] || 'home';

const StackPage = React.memo(function StackPage({
  entry,
  open,
  shown,
  backTo,
  className,
}: {
  entry: Entry;
  open: boolean;
  shown: boolean;
  backTo: boolean;
  className: string;
}) {
  return (
    <motion.div
      data-page={pageName(entry.pathname)}
      data-back-to={backTo ? entry.pathname : undefined}
      data-back-y={backTo ? (leftAt.get(entry.key)?.y ?? 0) : undefined}
      data-back-art={backTo ? leftAt.get(entry.key)?.art : undefined}
      {...PAGE_FADE}
      initial={entry.still || pageOpening() ? false : PAGE_FADE.initial}
      inert={!open}
      className={cn(
        className,
        !open &&
          'invisible absolute inset-x-0 top-0 [content-visibility:hidden]'
      )}
    >
      <PageShown.Provider value={open && shown}>
        <PageSearch.Provider value={entry.searchStr}>
          {entry.view}
        </PageSearch.Provider>
      </PageShown.Provider>
      {open && shown && <PageScroll />}
    </motion.div>
  );
});

/**
 * A page for each history entry, the open one shown and the ones Back returns
 * to kept hidden as they were left; `covered` while the player is open over them.
 */
export function PageStack({
  className,
  covered,
}: {
  className: string;
  covered: boolean;
}) {
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });
  const [state, setState] = React.useState<{
    location?: ParsedLocation;
    stack: Entry[];
  }>({ stack: [] });
  let { stack } = state;
  if (state.location !== location) {
    stack = settle(stack, location, router);
    setState({ location, stack });
  }
  React.useEffect(
    () =>
      router.subscribe('onBeforeLoad', ({ fromLocation }) => {
        if (fromLocation)
          leftAt.set(keyOf(fromLocation), {
            y: scrollY,
            art: currentWash()?.src,
          });
      }),
    [router]
  );
  const open = stack.at(-1);
  const back = stack.find((e) => e.index === (open?.index ?? 0) - 1);
  return stack.map((entry) => (
    <StackPage
      key={entry.id}
      entry={entry}
      open={entry === open}
      shown={!covered}
      backTo={entry === back}
      className={className}
    />
  ));
}
