import { Card } from '@/components/ui/card';
import { DashboardLoading } from '@/components/shared/dashboard-query-boundary';
import { ProviderEditor } from './_components/provider-editor';
import { useUsenetProviders } from './queries';

/**
 * Providers section: the multi-provider editor (add / edit / test / delete NNTP
 * accounts), wrapped with loading + error states for the providers query.
 */
export function UsenetProvidersPage() {
  const providers = useUsenetProviders();
  if (providers.isLoading) return <DashboardLoading />;
  if (providers.isError) {
    return (
      <Card className="p-6 text-sm text-red-500">
        Failed to load providers.
      </Card>
    );
  }
  return <ProviderEditor providers={providers.data?.providers ?? []} />;
}
