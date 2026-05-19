import { useStatus } from '@/context/status';
import {
  AppLayout,
  AppLayoutContent,
  AppLayoutSidebar,
  AppSidebarProvider,
} from '@/components/ui/app-layout';
import { MainSidebar } from './main-sidebar';
import { LoadingOverlayWithLogo } from '@/components/shared/loading-overlay';
import { MenuProvider } from '@/context/menu';
import { MenuContent } from '@/components/menu-content';
import { LoadingOverlay } from '@/components/ui/loading-spinner';
import { TopNavbar } from './top-navbar';
import { Button } from '@/components/ui/button';
import { UserDataProvider } from '@/context/userData';
import { SaveProvider } from '@/context/save';
import { LuffyError } from '@/components/shared/luffy-error';
import { OptionsProvider } from '@/context/options';
import { ModeProvider } from '@/context/mode';
import { SubTabProvider } from '@/context/sub-tab';
import { QuickActionsProvider } from '@/context/quick-actions';
import { CommandPaletteProvider } from '@/context/command-palette';
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
    <MenuProvider>
      <SubTabProvider>
        <QuickActionsProvider>
          <CommandPaletteProvider>
            <SaveProvider>
              <AppSidebarProvider>
                <AppLayout withSidebar sidebarSize="slim">
                  <AppLayoutSidebar>
                    <MainSidebar />
                  </AppLayoutSidebar>
                  <AppLayout>
                    <AppLayoutContent>
                      <div data-main-layout-container className="h-auto">
                        <TopNavbar />
                        <div data-main-layout-content>
                          <MenuContent />
                        </div>
                      </div>
                    </AppLayoutContent>
                  </AppLayout>
                </AppLayout>
              </AppSidebarProvider>
            </SaveProvider>
            <CommandPalette />
          </CommandPaletteProvider>
        </QuickActionsProvider>
      </SubTabProvider>
    </MenuProvider>
  );
}

export default function ConfigurePage() {
  return (
    <UserDataProvider>
      <OptionsProvider>
        <ModeProvider>
          <AppContent />
        </ModeProvider>
      </OptionsProvider>
    </UserDataProvider>
  );
}
