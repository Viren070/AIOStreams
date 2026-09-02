import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/loading-spinner';

/**
 * Engine settings moved onto the main Settings page. This section stays in
 * the usenet nav (sidebar accordion, mobile select) purely for discoverability
 * and old deep links
 */
const REDIRECT_DELAY_MS = 1200;

export function UsenetSettingsMovedPage({ field }: { field?: string }) {
  const navigate = useNavigate();

  React.useEffect(() => {
    const t = setTimeout(() => {
      navigate({
        to: '/dashboard/settings',
        search: { tab: 'usenet', field },
        replace: true,
      });
    }, REDIRECT_DELAY_MS);
    return () => clearTimeout(t);
  }, [navigate, field]);

  return (
    <Card className="p-6 flex items-center gap-3 text-sm text-[--muted]">
      <Spinner className="w-4 h-4" />
      This page has moved to Settings → Usenet. Redirecting…
    </Card>
  );
}
