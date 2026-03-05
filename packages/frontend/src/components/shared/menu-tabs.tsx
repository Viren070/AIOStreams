'use client';

import * as React from 'react';
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
}

const COLS_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

export function MenuTabs({ tabs, activeTab, onTabChange }: MenuTabsProps) {
  const n = tabs.length;
  const currentIndex = tabs.findIndex((t) => t.value === activeTab);
  // Mobile accordion tracks its own open state so it can be fully collapsed.
  // When an item is opened we still sync the shared tab state (URL params etc.).
  const [mobileOpen, setMobileOpen] = React.useState('');

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

      {/* Desktop: Tab bar + sliding content strip */}
      <div className="hidden sm:block">
        <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
          <TabsList
            className={`grid w-full border-b border-[--border] ${COLS_CLASS[n] ?? 'grid-cols-4'}`}
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex items-center gap-1.5"
              >
                {tab.icon}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="overflow-hidden mt-4">
          <div
            className="flex transition-transform duration-300 ease-in-out will-change-transform"
            style={{
              width: `${n * 100}%`,
              transform: `translateX(calc(-${currentIndex} / ${n} * 100%))`,
            }}
          >
            {tabs.map((tab) => (
              <div
                key={tab.value}
                ref={(el) => {
                  if (el) el.inert = tab.value !== activeTab;
                }}
                className="space-y-4 min-w-0"
                style={{ width: `${100 / n}%` }}
              >
                {tab.content}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
