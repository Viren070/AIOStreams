import { cn } from '@aiostreams/ui/core/styling';
import React from 'react';

type SettingsCardProps = {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
  danger?: boolean;
};

/** The heading of the group a section is in, which the section then doesn't repeat. */
export const SectionGroup = React.createContext<string | null>(null);

export function SettingsCard({
  title,
  description,
  children,
  action,
  id,
  danger,
}: SettingsCardProps) {
  if (title === React.useContext(SectionGroup)) title = undefined;
  return (
    <section id={id} data-settings-card className="scroll-mt-24 space-y-2">
      {(title || description || action) && (
        <div className="flex items-end justify-between gap-4 px-1">
          <div className="min-w-0">
            {title && (
              <h3
                className={cn(
                  'text-sm font-semibold',
                  danger ? 'text-red-300' : 'text-gray-100'
                )}
              >
                {title}
              </h3>
            )}
            {description && (
              <div className="mt-0.5 text-xs text-[--muted]">{description}</div>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          'space-y-3 rounded-xl border p-4',
          danger
            ? 'border-red-500/30 bg-red-950/20'
            : 'border-[--border] bg-gray-950/50'
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Edge-to-edge rows in a section. */
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <div className="-m-4 divide-y divide-[--border]">{children}</div>;
}

export function SettingsPageHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20">
        <Icon className="text-2xl text-brand-600 dark:text-brand-400" />
      </div>
      <div>
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="text-base text-[--muted]">{description}</p>
      </div>
    </div>
  );
}
