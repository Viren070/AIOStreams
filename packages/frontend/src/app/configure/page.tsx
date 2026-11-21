import { useStatus } from '@/context/status';
import { LoadingOverlayWithLogo } from '@/components/shared/loading-overlay';
import { MenuProvider } from '@/context/menu';
import { ConfigureLayout } from './layout';
import { LoadingOverlay } from '@aiostreams/ui/loading-spinner';
import { UserDataProvider } from '@/context/userData';
import { SaveProvider } from '@/context/save';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { ModeProvider } from '@/context/mode';
import { QuickActionsProvider } from '@/context/quick-actions';
import { CommandPaletteProvider } from '@/context/command-palette';
import { ConfigAuthProvider } from '@/context/config-auth';
import { CommandPalette } from '@/components/shared/command-palette';
import { useQueryClient } from '@tanstack/react-query';
import { statusQuery } from '@/lib/queries';

function ErrorOverlay({ error }: { error: string | null }) {
  const queryClient = useQueryClient();
  return (
    <LoadingOverlay showSpinner={false}>
      <LuffyError
        title="Something went wrong!"
        reset={() =>
          queryClient.refetchQueries({ queryKey: statusQuery.queryKey })
        }
      >
        <p>{error}</p>
      </LuffyError>
    </LoadingOverlay>
  );
}

function AppContent() {
  const { status, loading, error } = useStatus();

  if (loading) {
    return <LoadingOverlayWithLogo title="Launching. . ." />;
  }

  if (error || !status) {
    return <ErrorOverlay error={error} />;
  }

  return (
    <ConfigAuthProvider>
      <MenuProvider>
        <QuickActionsProvider>
          <CommandPaletteProvider>
            <SaveProvider>
              <ConfigureLayout />
            </SaveProvider>
            <CommandPalette />
          </CommandPaletteProvider>
        </QuickActionsProvider>
      </MenuProvider>
    </ConfigAuthProvider>
  );
}

export default function ConfigurePage() {
  return (
    <UserDataProvider>
      <ModeProvider>
        <AppContent />
      </ModeProvider>
    </UserDataProvider>
  );
}
