import React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { BiErrorCircle, BiRefresh } from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/loading-spinner';
import { cn } from '@/components/ui/core/styling';

/**
 * Default loading fallback used when a page doesn't supply a custom skeleton.
 * Intentionally lightweight — a centred spinner inside whatever container the
 * caller already provides.
 */
export function DashboardLoading({ className }: { className?: string }) {
  return (
    <div
      className={cn('p-8 flex items-center justify-center w-full', className)}
    >
      <Spinner className="w-6 h-6" />
    </div>
  );
}

/**
 * Shared error card with a retry button. Exposed separately so callers driven
 * by non-React-Query sources (e.g. SSE hooks) can use the same visuals as the
 * query boundary.
 */
export function DashboardErrorCard({
  title = 'Failed to load',
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        'p-6 flex flex-col items-center text-center gap-3',
        className
      )}
    >
      <BiErrorCircle className="w-8 h-8 text-red-500" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {message && (
          <p className="text-sm text-[--muted] break-words max-w-md">
            {message}
          </p>
        )}
      </div>
      {onRetry && (
        <Button
          size="sm"
          intent="warning-subtle"
          leftIcon={<BiRefresh />}
          loading={retrying}
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </Card>
  );
}

function errorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Single source of truth for "page driven by one React Query" loading/error
 * states. Renders:
 *   - `skeleton` (or {@link DashboardLoading}) while the query is pending,
 *   - {@link DashboardErrorCard} with a retry button on error,
 *   - `children(data)` once data has resolved.
 *
 * Use {@link DashboardErrorCard} + {@link DashboardLoading} directly for
 * pages whose primary source is an SSE/EventSource hook rather than a query.
 */
export function DashboardQueryBoundary<T>({
  query,
  skeleton,
  errorTitle,
  children,
}: {
  query: UseQueryResult<T, unknown>;
  skeleton?: React.ReactNode;
  errorTitle?: string;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <DashboardLoading />}</>;
  if (query.isError) {
    return (
      <DashboardErrorCard
        title={errorTitle ?? 'Failed to load'}
        message={errorMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  return <>{children(query.data as T)}</>;
}
