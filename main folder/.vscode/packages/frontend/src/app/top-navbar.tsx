// import { OfflineTopMenu } from '@/app/(main)/(offline)/offline/_components/offline-top-menu';
import { LayoutHeaderBackground } from '@/components/layout-header-background';
import { useStatus } from '@/context/status';
import { AppSidebarTrigger } from '@/components/ui/app-layout';
import { cn } from '@/components/ui/core/styling';

import React from 'react';
import { PageControls } from '@/components/shared/page-controls';
import { useMenu } from '@/context/menu';
import { Button } from '@/components/ui/button';
import { HeartIcon } from 'lucide-react';
import { useDisclosure } from '@/hooks/disclosure';
import { DonationModal } from '@/components/shared/donation-modal';

type TopNavbarProps = {
  children?: React.ReactNode;
};

export function TopNavbar(props: TopNavbarProps) {
  const { children, ...rest } = props;
  const { selectedMenu } = useMenu();
  const donationModal = useDisclosure(false);
  const serverStatus = useStatus();
  const isOffline = !serverStatus.status;

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
          className="relative z-10 px-4 w-full flex flex-row md:items-center overflow-x-auto"
        >
          <div
            data-top-navbar-content
            className="flex items-center w-full gap-3"
          >
            <AppSidebarTrigger />
            <div
              data-top-navbar-content-separator
              className="flex flex-1"
            ></div>
            {selectedMenu !== 'about' ? (
              <div className="block lg:hidden">
                <PageControls />
              </div>
            ) : (
              <div className="block lg:hidden absolute top-0 right-4">
                <Button
                  intent="alert-subtle"
                  size="md"
                  leftIcon={<HeartIcon />}
                  onClick={donationModal.open}
                >
                  Support Me
                </Button>
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
