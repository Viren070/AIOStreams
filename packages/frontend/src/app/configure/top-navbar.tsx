// import { OfflineTopMenu } from '@/app/(main)/(offline)/offline/_components/offline-top-menu';
import { LayoutHeaderBackground } from '@/components/layout-header-background';
import { AppSidebarTrigger } from '@/components/ui/app-layout';
import { cn } from '@/components/ui/core/styling';

import React from 'react';
import { PageControls } from '@/components/shared/page-controls';
import { useMenu } from '@/context/menu';
import { IconButton } from '@/components/ui/button';
import { BiHeart, BiLogInCircle, BiLogOutCircle } from 'react-icons/bi';
import { useDisclosure } from '@/hooks/disclosure';
import { DonationModal } from '@/components/shared/donation-modal';
import { useCommandPalette } from '@/context/command-palette';
import { CommandPaletteTopBarButton } from '@/components/shared/command-palette/search-button';
import { useConfigAuth } from '@/context/config-auth';

type TopNavbarProps = {
  children?: React.ReactNode;
};

export function TopNavbar(props: TopNavbarProps) {
  const { selectedMenu } = useMenu();
  const { open: openCommandPalette } = useCommandPalette();
  const { isSignedIn, toggleSession } = useConfigAuth();
  const donationModal = useDisclosure(false);

  return (
    <>
      <div
        data-top-navbar
        className={cn(
          'w-full h-[5rem] relative overflow-hidden flex items-center',
          'lg:hidden'
        )}
      >
        <div
          data-top-navbar-content-container
          className="relative z-10 px-4 w-full flex flex-row md:items-center overflow-x-auto overflow-y-hidden"
        >
          <div
            data-top-navbar-content
            className="flex items-center w-full gap-3"
          >
            <AppSidebarTrigger />
            <CommandPaletteTopBarButton
              label="Search settings"
              onOpen={openCommandPalette}
            />
            {selectedMenu === 'about' ? (
              // The about page has no page controls, so donate and the session
              // button sit on their own at the end of the bar.
              <div className="flex items-center gap-2 lg:hidden ml-auto">
                <IconButton
                  icon={<BiHeart />}
                  intent="alert-outline"
                  rounded
                  size="md"
                  onClick={donationModal.open}
                />
                <IconButton
                  icon={isSignedIn ? <BiLogOutCircle /> : <BiLogInCircle />}
                  intent="white-outline"
                  rounded
                  size="md"
                  onClick={toggleSession}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 lg:hidden">
                <PageControls />
              </div>
            )}
          </div>
        </div>
        <DonationModal
          open={donationModal.isOpen}
          onOpenChange={donationModal.toggle}
        />
        <LayoutHeaderBackground />
      </div>
    </>
  );
}
