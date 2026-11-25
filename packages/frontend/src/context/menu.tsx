import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useRouter } from '@tanstack/react-router';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useStatus } from './status';
import { useUserData } from './userData';
import { isPageId, PAGE_GROUPS, type PageId } from '@/lib/configure-pages';
import { slide } from '@/lib/slide';

/** Has the sidebar; between this and a phone, the sidebar is a drawer. */
export const WIDE_LAYOUT = '(min-width: 1024px)';
/** Reaches pages through a page list of its own. */
export const PHONE_LAYOUT = '(max-width: 767px)';

type MenuContextType = {
  page: PageId;
  /** What a page has open inside it, such as one filter. */
  pageTab: string | null;
  /** The page list, which on wider screens is the sidebar instead. */
  listed: boolean;
  /** A tab only opens on a page that has tabs. */
  setPage: (page: PageId, tab?: string | null) => void;
  showPages: () => void;
  /** Up a level: out of what a page has open, to the page list, then Home. */
  back: () => void;
  fadeIn: boolean;
  pages: PageId[];
};

const MenuContext = createContext<MenuContextType>({
  page: 'home',
  pageTab: null,
  listed: false,
  setPage: () => {},
  showPages: () => {},
  back: () => {},
  fadeIn: false,
  pages: [],
});

const PAGE_TAB_KEYS: Partial<Record<PageId, string>> = {
  filters: 'filter',
  addons: 'view',
};
/** Old addresses' menus and tab keys. */
const LEGACY_MENU_PAGES = new Map<string, PageId>([
  ['about', 'home'],
  ['services', 'services'],
  ['addons', 'addons'],
  ['filters', 'filters'],
  ['sorting', 'results'],
  ['formatter', 'formatter'],
  ['proxy', 'playback'],
  ['miscellaneous', 'advanced'],
  ['stats', 'stats'],
  ['save-install', 'stremio'],
]);
const LEGACY_TAB_KEYS = ['filter', 'misc-tab', 'service-tab', 'addons-tab'];
/** Set on an entry opened from its parent, so going up can step back to it. */
const FROM_PARENT = 'configureFromParent';

/** In the address as a page, though only a phone shows it as one. */
const PAGE_LIST = 'pages';

interface Nav {
  /** Home is `null`, so its address has no page. */
  page: PageId | typeof PAGE_LIST | null;
  pageTab: string | null;
}

const homeless = (page: Nav['page']) => (page === 'home' ? null : page);

function navOf(search: string, legacy = false): Nav {
  const params = new URLSearchParams(search);
  const raw = params.get('page');
  const menu = params.get('menu');
  const page = homeless(
    isPageId(raw) || raw === PAGE_LIST
      ? raw
      : (legacy && menu && LEGACY_MENU_PAGES.get(menu)) || null
  );
  const key = isPageId(page) && PAGE_TAB_KEYS[page];
  return { page, pageTab: key ? params.get(key) : null };
}

function hrefOf(nav: Nav): string {
  const url = new URL(window.location.href);
  for (const key of ['menu', 'page', 'view', ...LEGACY_TAB_KEYS]) {
    url.searchParams.delete(key);
  }
  if (nav.page) url.searchParams.set('page', nav.page);
  const key = isPageId(nav.page) && PAGE_TAB_KEYS[nav.page];
  if (key && nav.pageTab) url.searchParams.set(key, nav.pageTab);
  return url.pathname + url.search + url.hash;
}

const parentOf = (nav: Nav): Nav | null =>
  nav.pageTab
    ? { page: nav.page, pageTab: null }
    : nav.page === PAGE_LIST
      ? { page: null, pageTab: null }
      : nav.page
        ? { page: PAGE_LIST, pageTab: null }
        : null;

const sameNav = (a: Nav, b: Nav) =>
  a.page === b.page && a.pageTab === b.pageTab;

type Move = 'none' | 'fade' | 'open' | 'close' | 'push' | 'pop';

/** On a phone, left to right: the page list, Home, then a page. */
const placeOf = (nav: Nav) => (nav.page === PAGE_LIST ? 0 : !nav.page ? 1 : 2);

/** A page's own levels slide; so do a phone's Home, page list and pages. */
function moveOf(from: Nav, to: Nav, phone: boolean): Move {
  const shown = (nav: Nav) =>
    !phone && nav.page === PAGE_LIST ? null : nav.page;
  if (shown(from) === shown(to)) {
    if (from.pageTab === to.pageTab) return 'none';
    return to.pageTab ? 'open' : 'close';
  }
  if (phone && placeOf(from) !== placeOf(to))
    return placeOf(to) > placeOf(from) ? 'push' : 'pop';
  return 'fade';
}

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const phone = useMediaQuery(PHONE_LAYOUT);

  const { status } = useStatus();
  const user = useUserData();
  const statsAvailable =
    status?.settings.userAnalyticsEnabled === true && Boolean(user.uuid);

  // Without the media server, profiles only shape Stremio install links.
  const profilesAvailable =
    status?.settings?.jellyfin?.enabled === true ||
    (user.userData.profiles ?? []).some((p) => p.id !== '');
  const pages = useMemo(
    () =>
      PAGE_GROUPS.flatMap((group) => group.pages).filter(
        (page) =>
          (page !== 'stats' || statsAvailable) &&
          (page !== 'profiles' || profilesAvailable)
      ),
    [statsAvailable, profilesAvailable]
  );

  const [nav, setNav] = useState<Nav>(() =>
    navOf(window.location.search, true)
  );
  const [fadeIn, setFadeIn] = useState(true);
  const current = useRef(nav);
  current.current = nav;
  const phoneNow = useRef(phone);
  phoneNow.current = phone;
  /** Scroll positions by history entry, put back on the way back. */
  const scrolls = useRef(new Map<string, number>());
  const browserAnimated = useRef(false);

  const entryKey = () =>
    String((router.history.location.state as { key?: string }).key ?? '');

  const show = (to: Nav, move: Move, y: number, write?: () => void) => {
    const slides = move !== 'none' && move !== 'fade';
    const apply = () => {
      write?.();
      setNav(to);
      setFadeIn(move === 'fade');
      window.scrollTo(0, y);
    };
    if (!slides) apply();
    else
      slide(apply, {
        back: move === 'close' || move === 'pop',
        scoped: move === 'open' || move === 'close',
      });
  };

  const navigate = (to: Nav, replace = false) => {
    const from = current.current;
    if (sameNav(from, to)) return;
    scrolls.current.set(entryKey(), window.scrollY);
    const parent = parentOf(to);
    const state = {
      [FROM_PARENT]: !replace && !!parent && sameNav(parent, from),
    };
    show(to, moveOf(from, to, phoneNow.current), 0, () =>
      replace
        ? router.history.replace(hrefOf(to), state)
        : router.history.push(hrefOf(to), state)
    );
  };

  useEffect(() => {
    const path = window.location.pathname;
    const restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    // Runs before the router's own listener, which reports the move.
    const notePop = (event: PopStateEvent) => {
      browserAnimated.current = !!(event as { hasUAVisualTransition?: boolean })
        .hasUAVisualTransition;
    };
    window.addEventListener('popstate', notePop, { capture: true });
    const stop = router.history.subscribe(({ location, action }) => {
      if (location.pathname !== path) return;
      const to = navOf(location.search);
      const from = current.current;
      if (sameNav(from, to)) return;
      if (action.type === 'PUSH' || action.type === 'REPLACE') {
        setNav(to);
        return;
      }
      const y =
        scrolls.current.get(
          String((location.state as { key?: string }).key ?? '')
        ) ?? 0;
      const move = moveOf(from, to, phoneNow.current);
      show(to, browserAnimated.current ? 'none' : move, y);
      browserAnimated.current = false;
    });
    return () => {
      stop();
      window.removeEventListener('popstate', notePop, { capture: true });
      window.history.scrollRestoration = restoration;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // An old address by menu is rewritten to the page it opens.
  useEffect(() => {
    const href = hrefOf(current.current);
    if (href !== window.location.pathname + window.location.search)
      router.history.replace(href, router.history.location.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPage = (page: PageId, tab: string | null = null) =>
    navigate({
      page: homeless(page),
      pageTab: PAGE_TAB_KEYS[page] ? tab : null,
    });

  const showPages = () => navigate({ page: PAGE_LIST, pageTab: null });

  const back = () => {
    const parent = parentOf(current.current);
    if (!parent) return;
    const state = router.history.location.state as { [FROM_PARENT]?: boolean };
    if (state[FROM_PARENT]) router.history.back();
    else navigate(parent, true);
  };

  return (
    <MenuContext.Provider
      value={{
        page: isPageId(nav.page) ? nav.page : 'home',
        pageTab: nav.pageTab,
        listed: nav.page === PAGE_LIST && phone,
        setPage,
        showPages,
        back,
        fadeIn,
        pages,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export const useMenu = () => useContext(MenuContext);
