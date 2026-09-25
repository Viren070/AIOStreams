import React from 'react';
import type { IconType } from 'react-icons';
import { Card } from '@aiostreams/ui/card';
import { cn } from '@aiostreams/ui/core/styling';

export function SettingsCard({
  title,
  description,
  children,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {(title || description) && (
        <div>
          {title && <p className="font-semibold">{title}</p>}
          {description && (
            <p className="text-sm text-[--muted]">{description}</p>
          )}
        </div>
      )}
      <Card className="divide-y-2 divide-gray-700/40 overflow-clip rounded-xl border-white/10 bg-gray-950/70">
        {React.Children.map(children, (child) =>
          child ? (
            <div className="p-3 transition-colors hover:bg-gray-900">
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
}: {
  title: string;
  description: string;
  icon: IconType;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-lg border border-brand-500/15 bg-gradient-to-br from-brand-500/10 to-purple-500/10 p-2">
        <Icon className="text-2xl text-brand-400" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-[--muted]">{description}</p>
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
