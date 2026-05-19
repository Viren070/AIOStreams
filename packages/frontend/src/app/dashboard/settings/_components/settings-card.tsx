import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import type { IconType } from 'react-icons';

export function SettingsNavCard({ children }: { children: React.ReactNode }) {
  return <div className="pb-4">{children}</div>;
}

export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        'group/settings-card relative lg:bg-gray-950/5 dark:lg:bg-gray-950/40 rounded-xl transition-colors',
        className
      )}
    >
      {title && (
        <div className="p-0 pb-2 flex flex-col lg:flex-row items-start lg:items-center gap-0 mx-3 mt-3 space-y-0">
          <span
            className={cn(
              'font-semibold text-[1rem] tracking-wide px-4 py-1 border w-fit rounded-xl flex-none',
              'bg-gray-800/10 dark:bg-gray-800/40 transition-colors duration-300',
              'group-hover/settings-card:bg-brand-500/10 group-hover/settings-card:text-white'
            )}
          >
            {title}
          </span>
          {description && (
            <span className="px-4 py-2 lg:py-0 w-fit text-sm text-[--muted]">
              {description}
            </span>
          )}
        </div>
      )}
      <div className={cn(!title && 'pt-4', 'p-4 space-y-4')}>{children}</div>
    </Card>
  );
}

export function SettingsPageHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: IconType;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg bg-gradient-to-br from-brand-500/10 to-purple-500/10 border border-brand-500/15">
        <Icon className="text-2xl text-brand-600 dark:text-brand-400" />
      </div>
      <div>
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="text-base text-[--muted]">{description}</p>
      </div>
    </div>
  );
}
