import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '../ui/accordion';

export interface MenuTabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  content: React.ReactNode;
}

interface MenuTabsProps {
  tabs: MenuTabItem[];
  activeTab: string;
  onTabChange: (value: string) => void;
  /** Which accordion item to expand by default on mobile. Defaults to none. */
  defaultMobileOpen?: string;
  /**
   * On tab change, scroll the page so the selected tab's content is fully
   * visible (only when it fits on screen).
   */
  revealOnChange?: boolean;
}

// Direction-aware slide: entering panel comes in from the side you're heading
// towards, the exiting one leaves the opposite way. `custom` carries the sign.
const panelVariants = {
  enter: (dir: number) => ({ x: dir >= 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? -40 : 40, opacity: 0 }),
};

export function MenuTabs({
  tabs,
  activeTab,
  onTabChange,
  defaultMobileOpen = '',
  revealOnChange = false,
}: MenuTabsProps) {
  const currentIndex = tabs.findIndex((t) => t.value === activeTab);
  const activeContent = currentIndex >= 0 ? tabs[currentIndex].content : null;

  // Remember the previous tab position so we know which way to slide. Read
  // during render (ref, not state, so it stays in sync with the same paint);
  // committed after.
  const prevIndexRef = React.useRef(currentIndex);
  const direction =
    currentIndex === prevIndexRef.current
      ? 0
      : currentIndex > prevIndexRef.current
        ? 1
        : -1;
  React.useEffect(() => {
    prevIndexRef.current = currentIndex;
  }, [currentIndex]);

  // When enabled, bring the freshly selected tab's content fully into view if
  // it fits on screen but hangs below the fold. Never scrolls on first mount,
  // never fights the tab bar off-screen (only reveals what fits).
  const panelRef = React.useRef<HTMLDivElement>(null);
  const mountedRef = React.useRef(false);
  React.useEffect(() => {
    if (!revealOnChange) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 32;
    const vh = window.innerHeight;
    // Only if the whole panel fits and its bottom is cut off below the fold.
    if (rect.height + margin <= vh && rect.bottom + margin > vh) {
      window.scrollBy({ top: rect.bottom + margin - vh, behavior: 'smooth' });
    }
  }, [activeTab, revealOnChange]);

  // Mobile accordion tracks its own open state so it can be fully collapsed.
  // When an item is opened we still sync the shared tab state (URL params etc.).
  const [mobileOpen, setMobileOpen] = React.useState(
    defaultMobileOpen || activeTab
  );

  React.useEffect(() => {
    setMobileOpen(activeTab);
  }, [activeTab]);

  const handleMobileChange = (value: string) => {
    setMobileOpen(value);
    if (value) onTabChange(value);
  };

  return (
    <>
      {/* Mobile: Accordion */}
      <div className="sm:hidden space-y-2">
        <Accordion
          type="single"
          collapsible
          value={mobileOpen}
          onValueChange={handleMobileChange}
        >
          {tabs.map((tab) => (
            <AccordionItem
              key={tab.value}
              value={tab.value}
              className="border border-[--border] rounded-[--radius-md] overflow-hidden mb-2"
            >
              <AccordionTrigger>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {tab.icon}
                  {tab.label}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div
                  ref={(el) => {
                    if (el) el.inert = mobileOpen !== tab.value;
                  }}
                  className="space-y-4"
                >
                  {tab.content}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* Desktop: Tab bar + animated content panel */}
      <div className="hidden sm:block">
        <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
          <TabsList className="flex w-full border-b border-[--border] overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex flex-1 basis-0 items-center gap-1.5"
              >
                {tab.icon}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* Only the active tab is mounted; it slides in as the previous one
            slides out (popLayout keeps the entrant in flow, so the region
            takes each tab's natural height instead of the tallest tab's). */}
        <div ref={panelRef} className="relative mt-4 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={activeTab}
              custom={direction}
              variants={panelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              className="space-y-4 p-1"
            >
              {activeContent}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
