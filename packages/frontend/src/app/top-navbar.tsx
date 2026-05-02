// import { OfflineTopMenu } from '@/app/(main)/(offline)/offline/_components/offline-top-menu';
import { LayoutHeaderBackground } from '@/components/layout-header-background';
import { useStatus } from '@/context/status';
import { AppSidebarTrigger } from '@/components/ui/app-layout';
import { cn } from '@/components/ui/core/styling';

import React from 'react';
import { PageControls } from '@/components/shared/page-controls';
import { useMenu } from '@/context/menu';
import { Button, IconButton } from '@/components/ui/button';
import { useDisclosure } from '@/hooks/disclosure';
import { DonationModal } from '@/components/shared/donation-modal';
import { BiLogInCircle, BiLogOutCircle, BiSearch } from 'react-icons/bi';
import { useCommandPalette } from '@/context/command-palette';
import { ConfigModal } from '@/components/config-modal';
import { useUserData } from '@/context/userData';
import { toast } from 'sonner';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';

type TopNavbarProps = {
  children?: React.ReactNode;
};

export function TopNavbar(props: TopNavbarProps) {
  const { children, ...rest } = props;
  const { selectedMenu } = useMenu();
  const donationModal = useDisclosure(false);
  const signInModal = useDisclosure(false);
  const serverStatus = useStatus();
  const isOffline = !serverStatus.status;
  const { userData, setUserData, uuid, setUuid, password, setPassword } =
    useUserData();
  const { open: openCommandPalette } = useCommandPalette();

  const confirmClearConfig = useConfirmationDialog({
    title: 'Sign Out',
    description: 'Are you sure you want to sign out?',
    onConfirm: () => {
      setUserData(null);
      setUuid(null);
      setPassword(null);
    },
  });

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
            <button
              type="button"
              onClick={() => openCommandPalette()}
              aria-label="Search settings"
              className="flex-1 flex items-center gap-2 h-9 px-3 rounded-md border border-[--border] bg-[--subtle]/50 hover:bg-[--subtle] text-[--muted] hover:text-[--foreground] transition-colors text-sm truncate"
            >
              <BiSearch className="text-base shrink-0" />
              <span className="flex-1 text-left">Search...</span>
            </button>
            {selectedMenu !== 'about' ? (
              <div className="flex items-center gap-2 lg:hidden">
                <PageControls
                  middleContent={
                    <IconButton
                      icon={
                        uuid && password ? (
                          <BiLogOutCircle />
                        ) : (
                          <BiLogInCircle />
                        )
                      }
                      intent="white-outline"
                      rounded
                      // className="hidden sm:inline-flex"
                      size="md"
                      onClick={() => {
                        if (uuid && password) {
                          confirmClearConfig.open();
                        } else {
                          signInModal.open();
                        }
                      }}
                    />
                  }
                />
              </div>
            ) : (
              <div className="block lg:hidden">
                <Button
                  intent="primary-subtle"
                  size="md"
                  iconClass="text-3xl"
                  leftIcon={
                    uuid && password ? <BiLogOutCircle /> : <BiLogInCircle />
                  }
                  onClick={() => {
                    if (uuid && password) {
                      confirmClearConfig.open();
                    } else {
                      signInModal.open();
                    }
                  }}
                >
                  {uuid && password ? 'Sign Out' : 'Sign In'}
                </Button>
              </div>
            )}
          </div>
        </div>
        <DonationModal
          open={donationModal.isOpen}
          onOpenChange={donationModal.toggle}
        />
        <ConfigModal
          open={signInModal.isOpen}
          onSuccess={() => {
            signInModal.close();
            toast.success('Signed in successfully');
          }}
          onOpenChange={(v) => {
            if (!v) {
              signInModal.close();
            }
          }}
        />
        <ConfirmationDialog {...confirmClearConfig} />
        <LayoutHeaderBackground />
      </div>
    </>
  );
}
