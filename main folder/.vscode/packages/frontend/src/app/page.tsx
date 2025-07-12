'use client';

import { useStatus } from '@/context/status';
import { StatusProvider } from '@/context/status';
import { Toaster } from '@/components/ui/toaster';
import {
  AppLayout,
  AppLayoutContent,
  AppLayoutSidebar,
  AppSidebarProvider,
} from '@/components/ui/app-layout';
import { MainSidebar } from './main-sidebar';
import { LoadingOverlayWithLogo } from '@/components/shared/loading-overlay';
import { MenuProvider } from '@/context/menu';
import { MenuContent } from '../components/menu-content';
import { ThemeProvider } from 'next-themes';
import { LoadingOverlay } from '@/components/ui/loading-spinner';
import Image from 'next/image';
import { TopNavbar } from './top-navbar';
import { Button } from '@/components/ui/button';
import { UserDataProvider } from '@/context/userData';
import { LuffyError } from '@/components/shared/luffy-error';
import { TextGenerateEffect } from '@/components/shared/text-generate-effect';
import { OptionsProvider } from '@/context/options';

function ErrorOverlay({ error }: { error: string | null }) {
  return (
    <LoadingOverlay showSpinner={false}>
      <LuffyError title="Something went wrong!" showRefreshButton>
        <p>{error}</p>
      </LuffyError>
    </LoadingOverlay>
  );
}

function AppContent() {
  const { status, loading, error } = useStatus();

  if (loading) {
    return (
      <LoadingOverlay showSpinner>
        <TextGenerateEffect words="Launching..." className="text-2xl" />
      </LoadingOverlay>
    );
  }

  if (error || !status) {
    return <ErrorOverlay error={error} />;
  }

  return (
    <MenuProvider>
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
      <Toaster />
    </MenuProvider>
  );
}

export default function Home() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <StatusProvider>
        <UserDataProvider>
          <OptionsProvider>
            <AppContent />
          </OptionsProvider>
        </UserDataProvider>
      </StatusProvider>
    </ThemeProvider>
  );
}
