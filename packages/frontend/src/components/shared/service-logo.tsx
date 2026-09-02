import React from 'react';
import { ServiceId } from '@aiostreams/core';
import { cn } from '@/components/ui/core/styling';
import { SERVICE_LOGO_MAP } from '@/lib/services';

export function ServiceLogo({
  serviceId,
  shortName,
  className,
}: {
  serviceId: ServiceId;
  shortName: string;
  className?: string;
}) {
  const logoUrl = SERVICE_LOGO_MAP[serviceId];

  if (!logoUrl) {
    return (
      <div
        className={cn(
          'w-9 h-9 rounded-lg bg-[--subtle] border border-[--border] flex items-center justify-center text-xs font-bold font-mono shrink-0 text-[--muted]',
          className
        )}
      >
        {shortName}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={shortName}
      className={cn('w-9 h-9 rounded-lg object-contain shrink-0', className)}
    />
  );
}
