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
import { currentHost } from '@/lib/hosts';
import { CONTENT, pageOpening } from '@/lib/page-open';
import { PageSearch, PageShown } from '@/lib/page-shown';
import { PageScroll } from './page-scroll';

export type PageView = (match: {
  params: Record<string, string>;
  search: Record<string, string | undefined>;
}) => React.ReactElement;

/** Pages kept behind the open one, besides the last Home. */
const KEPT = 4;

/*
 * It rises by a whole transform and fades on an eased curve, which the browser
 * runs off the main thread, so the motion stays smooth while a TV still draws
 * the page; by `top` it was laid out again every frame. The transform goes
 * once it's done, as it would place a fixed child by the page.
 */
const PAGE_FADE = {
  initial: { opacity: 0, transform: 'translateY(6px)' },
  animate: {
    opacity: 1,
    transform: 'translateY(0px)',
    transitionEnd: { transform: 'none' },
  },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
} as const;

/**
 * A TV page only fades: what rises there is the content its page sets moving,
 * over a still backdrop. A title's page shows its backdrop at once, as faded
 * in whole the artwork behind it shone through first.
 */
const fadeFrom = (pathname: string) =>
  !currentHost().tv
    ? PAGE_FADE.initial
    : pathname.startsWith('/item/')
      ? false
      : { opacity: 0 };
/** On a TV, in step with the content's rise and the leaving page's fade. */
const fadeTiming = () =>
  currentHost().tv
    ? { duration: 0.32, ease: [0, 0, 0.6, 1] as const }
    : PAGE_FADE.transition;

/** As the artwork wash comes back behind it. */
const RISE_BACK = { duration: 450, easing: 'cubic-bezier(0, 0, 0.6, 1)' };

/**
 * On a TV, a page kept beneath rises into place as it shows again, as a page
 * opened does: its content, hidden as it's shown, rises once the frame that
 * draws it again is out, which takes a TV a while.
 */
function useRiseBack(showing: boolean) {
  const ref = React.useRef<HTMLDivElement>(null);
  const was = React.useRef(showing);
  React.useLayoutEffect(() => {
    const back = showing && !was.current;
    was.current = showing;
    const el = ref.current;
    // With reduced motion it shows at once, as the page that left it didn't move.
    if (
      !back ||
      !el ||
      !currentHost().tv ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const content = [...el.querySelectorAll<HTMLElement>(CONTENT)];
    // With none of its own to move, the page rises whole, as it did when opened.
    const parts = content.length ? content : [el];
    // Home's hero picture, filling the screen, comes up from dark with it.
    const art = [
      ...el.querySelectorAll<HTMLElement>(
        "[data-ui='hero'] > [data-ui='hero-art']"
      ),
    ];
    for (const part of [...parts, ...art]) part.style.opacity = '0';
    const show = () => {
      for (const part of [...parts, ...art]) part.style.opacity = '';
    };
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        show();
        for (const part of parts)
          part.animate(
            [
              { opacity: 0, transform: 'translateY(0.5rem)' },
              { opacity: 1, transform: 'none' },
            ],
            RISE_BACK
          );
        for (const part of art)
          part.animate([{ opacity: 0 }, { opacity: 1 }], RISE_BACK);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      show();
    };
  }, [showing]);
  return ref;
}

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
  const ref = useRiseBack(open && shown);
  return (
    <motion.div
      ref={ref}
      data-page={pageName(entry.pathname)}
      data-still={entry.still || undefined}
      data-back-to={backTo ? entry.pathname : undefined}
      data-back-y={backTo ? (leftAt.get(entry.key)?.y ?? 0) : undefined}
      data-back-art={backTo ? leftAt.get(entry.key)?.art : undefined}
      {...PAGE_FADE}
      transition={fadeTiming()}
      initial={entry.still || pageOpening() ? false : fadeFrom(entry.pathname)}
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
