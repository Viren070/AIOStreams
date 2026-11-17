import React from 'react';
import type { IconType } from 'react-icons';
import { Card } from '@aiostreams/ui/card';
import { cn } from '@aiostreams/ui/core/styling';

const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const searchWords = (query: string): string[] =>
  fold(query).split(/\s+/).filter(Boolean);

export const hasWords = (
  text: string | null | undefined,
  words: readonly string[]
) => {
  const folded = fold(text ?? '');
  return words.every((word) => folded.includes(word));
};

export const SettingsSearch = React.createContext<readonly string[]>([]);

export function SettingsCard({
  name,
  title,
  description,
  children,
}: {
  /** `data-name`, which custom CSS matches, so it stays in English. */
  name?: string;
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const words = React.useContext(SettingsSearch);
  const root = React.useRef<HTMLDivElement>(null);
  // By the text each line shows, so a search covers whatever this device lists.
  React.useLayoutEffect(() => {
    const card = root.current;
    if (!card || !words.length) return;
    const items = [
      ...card.querySelectorAll<HTMLElement>('[data-ui=settings-card-item]'),
    ];
    const whole = hasWords(title, words);
    for (const item of items)
      item.hidden = !whole && !hasWords(item.textContent, words);
    card.hidden = items.every((item) => item.hidden);
    return () => {
      card.hidden = false;
      for (const item of items) item.hidden = false;
    };
  });
  return (
    <div
      ref={root}
      data-ui="settings-card"
      data-name={name}
      className="space-y-3"
    >
      {(title || description) && (
        <div>
          {title && (
            <p data-ui="settings-card-title" className="font-semibold">
              {title}
            </p>
          )}
          {description && (
            <p
              data-ui="settings-card-description"
              className="text-sm text-[--muted]"
            >
              {description}
            </p>
          )}
        </div>
      )}
      <Card
        data-ui="settings-card-body"
        className="divide-y-2 divide-gray-700/40 overflow-clip rounded-xl border-white/10 bg-gray-950/70"
      >
        {React.Children.map(children, (child) =>
          child ? (
            <div
              data-ui="settings-card-item"
              className="p-3 transition-colors hover:bg-gray-900 empty:hidden"
            >
              {child}
            </div>
          ) : null
        )}
      </Card>
    </div>
  );
}

export function SettingsPageHeader({
  title,
  description,
  icon: Icon,
  leading,
}: {
  title: string;
  description: string;
  icon: IconType;
  leading?: React.ReactNode;
}) {
  return (
    <div data-ui="settings-header" className="flex items-center gap-3">
      {leading ?? (
        <div className="rounded-lg border border-brand-500/15 bg-gradient-to-br from-brand-500/10 to-purple-500/10 p-2">
          <Icon className="text-2xl text-brand-400" />
        </div>
      )}
      <div>
        <h2 data-ui="section-title" className="text-xl font-semibold">
          {title}
        </h2>
        <p data-ui="settings-header-description" className="text-[--muted]">
          {description}
        </p>
      </div>
    </div>
  );
}

export function SettingsRow({
  label,
  help,
  children,
  className,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {help && <p className="text-sm text-[--muted]">{help}</p>}
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}
