'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useMenu } from './menu';
import { useSubTabContext } from './sub-tab';
import type { MenuId } from '../../../core/src/utils/fieldMeta';

export type NavigateTarget = {
  menu: MenuId;
  /** Sub-tab within the destination menu, if it has tabs. */
  subTab?: string;
  /** Preferred scroll target id, then fallbacks (the first that exists wins). */
  sectionId?: string;
  fallbackSectionIds?: string[];
};

type CommandPaletteContextType = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  navigate: (target: NavigateTarget) => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextType>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  navigate: () => {},
});

const HIGHLIGHT_DURATION_MS = 1400;

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { selectedMenu, setSelectedMenu } = useMenu();
  const { setSubTab } = useSubTabContext();
  const previousHighlightRef = useRef<HTMLElement | null>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const scrollAndHighlight = useCallback((ids: string[]) => {
    // The destination menu and/or sub-tab may take a few frames to mount.
    // Poll (up to ~800ms) for the first id that resolves and is not inside an
    // inert panel. MenuTabs renders all tab panels simultaneously but marks
    // inactive ones `inert`, so we must wait until the panel becomes active
    // before scrolling — otherwise scrollIntoView fires while the element is
    // still translated off-screen.
    const start = performance.now();
    let wasInert = false;

    console.log('[cmd] scrollAndHighlight called, ids:', ids);

    // MenuTabs renders content twice (mobile accordion + desktop tabs). Use
    // querySelectorAll so we can pick the copy that is actually visible
    // (offsetParent !== null) rather than always getting the first DOM match
    // which may be inside a display:none container.
    const findVisible = (id: string): HTMLElement | null => {
      const all = document.querySelectorAll<HTMLElement>('#' + CSS.escape(id));
      console.log(`[cmd] querySelectorAll #${id} found ${all.length} element(s)`);
      for (const el of all) {
        const op = el.offsetParent;
        const rect = el.getBoundingClientRect();
        console.log(`[cmd]   candidate:`, el, `offsetParent:`, op, `rect:`, rect);
      }
      for (const el of all) {
        if (el.offsetParent !== null) return el;
      }
      return null;
    };

    const findAndScroll = () => {
      const elapsed = performance.now() - start;
      let el: HTMLElement | null = null;
      for (const id of ids) {
        const found = findVisible(id);
        if (found) {
          el = found;
          break;
        }
      }
      if (!el) {
        console.log(`[cmd] t+${elapsed.toFixed(0)}ms — no visible element found yet`);
        if (elapsed < 1200) {
          requestAnimationFrame(findAndScroll);
        } else {
          console.warn('[cmd] timed out waiting for element', ids);
        }
        return;
      }

      console.log(`[cmd] t+${elapsed.toFixed(0)}ms — visible element found:`, el.id, el, 'rect:', el.getBoundingClientRect());

      // If the element is inside an inert panel (e.g. inactive MenuTabs tab),
      // keep polling until the panel becomes active.
      let ancestor: Element | null = el.parentElement;
      let inertAncestor: Element | null = null;
      while (ancestor && ancestor !== document.documentElement) {
        if ((ancestor as HTMLElement).inert) {
          inertAncestor = ancestor;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      if (inertAncestor) {
        wasInert = true;
        console.log(`[cmd] t+${elapsed.toFixed(0)}ms — element is inert via ancestor:`, inertAncestor);
        if (elapsed < 1200) {
          requestAnimationFrame(findAndScroll);
        } else {
          console.warn('[cmd] timed out waiting for element to leave inert state', ids);
        }
        return;
      }

      console.log(`[cmd] t+${elapsed.toFixed(0)}ms — element is active (wasInert=${wasInert}), proceeding`);

      const doHighlight = () => {
        console.log(`[cmd] doHighlight firing, el:`, el!.id, el!.getBoundingClientRect());
        el!.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (previousHighlightRef.current) {
          previousHighlightRef.current.removeAttribute('data-command-target');
        }
        el!.setAttribute('data-command-target', 'true');
        previousHighlightRef.current = el;
        const target = el!;
        window.setTimeout(() => {
          if (target.getAttribute('data-command-target') === 'true') {
            target.removeAttribute('data-command-target');
          }
          if (previousHighlightRef.current === target) {
            previousHighlightRef.current = null;
          }
        }, HIGHLIGHT_DURATION_MS);
      };

      if (wasInert) {
        console.log('[cmd] wasInert=true, delaying doHighlight by 320ms');
        window.setTimeout(doHighlight, 320);
      } else {
        doHighlight();
      }
    };
    requestAnimationFrame(findAndScroll);
  }, []);

  const navigate = useCallback(
    (target: NavigateTarget) => {
      // Always update the sub-tab first so the destination renders the right
      // tab content immediately, regardless of whether we are switching menus.
      if (target.subTab) {
        setSubTab(target.menu, target.subTab);
      }
      if (selectedMenu !== target.menu) {
        setSelectedMenu(target.menu);
      }
      setIsOpen(false);
      const ids = [
        target.sectionId,
        ...(target.fallbackSectionIds ?? []),
      ].filter((v): v is string => Boolean(v));
      if (ids.length > 0) {
        scrollAndHighlight(ids);
      }
    },
    [selectedMenu, setSelectedMenu, setSubTab, scrollAndHighlight]
  );

  // Global Ctrl/Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <CommandPaletteContext.Provider
      value={{ isOpen, open, close, toggle, navigate }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
}

export const useCommandPalette = () => useContext(CommandPaletteContext);
