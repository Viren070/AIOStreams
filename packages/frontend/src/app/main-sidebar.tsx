'use client';

import React from 'react';
import { AppSidebar, useAppSidebarContext } from '@/components/ui/app-layout';
import { cn } from '@/components/ui/core/styling';
import { VerticalMenu, VerticalMenuItem } from '@/components/ui/vertical-menu';
import { Button } from '@/components/ui/button';
import { useStatus } from '@/context/status';
import { useMenu, MenuId } from '@/context/menu';
import { useUserData } from '@/context/userData';
import { ConfigModal } from '@/components/config-modal';
import {
  BiPen,
  BiInfoCircle,
  BiCloud,
  BiExtension,
  BiFilterAlt,
  BiSave,
  BiSort,
  BiCog,
  BiServer,
  BiSmile,
  BiHeart,
  BiLogOutCircle,
  BiLogInCircle,
  BiSearch,
} from 'react-icons/bi';
import { useCommandPalette } from '@/context/command-palette';
import { useRegisterQuickAction } from '@/context/quick-actions';
import { useRouter, usePathname } from 'next/navigation';
import { useDisclosure } from '@/hooks/disclosure';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { Modal } from '@/components/ui/modal';
import { TextInput } from '@/components/ui/text-input';
import { toast } from 'sonner';
import { Tooltip } from '@/components/ui/tooltip';
import { useOptions } from '@/context/options';
import { useMode } from '@/context/mode';
import { DonationModal } from '@/components/shared/donation-modal';
import { useSave } from '@/context/save';

type MenuItem = VerticalMenuItem & {
  id: MenuId;
};

export function MainSidebar() {
  const ctx = useAppSidebarContext();
  const [expandedSidebar, setExpandSidebar] = React.useState(false);
  const isCollapsed = !ctx.isBelowBreakpoint && !expandedSidebar;
  const { selectedMenu, setSelectedMenu } = useMenu();
  const pathname = usePathname();
  const { isOptionsEnabled, toggleOptions } = useOptions();
  const donationModal = useDisclosure(false);

  const user = useUserData();
  const signInModal = useDisclosure(false);
  const [initialUuid, setInitialUuid] = React.useState<string | null>(null);

  React.useEffect(() => {
    const uuidMatch = pathname.match(
      /stremio\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/.*\/configure/
    );
    if (uuidMatch) {
      const extractedUuid = uuidMatch[1];
      setInitialUuid(extractedUuid);
      signInModal.open();
    }
    // check for menu query param
    // const params = new URLSearchParams(window.location.search);
    // const menu = params.get('menu');
    // if (menu && VALID_MENUS.includes(menu)) {
    //   setSelectedMenu(menu);
    // }
  }, [pathname]);

  const { status, error, loading } = useStatus();
  const { mode, setMode } = useMode();
  const { open: openCommandPalette } = useCommandPalette();
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl K';

  const confirmClearConfig = useConfirmationDialog({
    title: 'Sign Out',
    description: 'Are you sure you want to sign out?',
    onConfirm: () => {
      user.setUserData(null);
      user.setUuid(null);
      user.setPassword(null);
    },
  });

  const isSignedIn = Boolean(user.uuid && user.password);

  useRegisterQuickAction(
    isSignedIn
      ? {
          id: 'sign-out',
          label: 'Sign Out',
          icon: <BiLogOutCircle />,
          keywords: ['logout', 'log out'],
          onSelect: () => confirmClearConfig.open(),
        }
      : {
          id: 'sign-in',
          label: 'Sign In',
          icon: <BiLogInCircle />,
          keywords: ['login', 'log in'],
          onSelect: () => signInModal.open(),
        },
    [isSignedIn, confirmClearConfig, signInModal]
  );

  useRegisterQuickAction(
    {
      id: 'donate',
      label: 'Donate',
      icon: <BiHeart />,
      keywords: ['support', 'sponsor'],
      onSelect: () => donationModal.open(),
    },
    [donationModal]
  );

  useRegisterQuickAction(
    {
      id: 'toggle-mode',
      label:
        mode === 'pro' ? 'Switch to Simple mode' : 'Switch to Advanced mode',
      icon: <BiCog />,
      keywords: ['mode', 'pro', 'noob', 'beginner', 'advanced'],
      onSelect: () => setMode(mode === 'pro' ? 'noob' : 'pro'),
    },
    [mode, setMode]
  );

  const topMenuItems: MenuItem[] = [
    {
      name: 'About',
      iconType: BiInfoCircle,
      isCurrent: selectedMenu === 'about',
      id: 'about',
    },
    {
      name: 'Services',
      iconType: BiCloud,
      isCurrent: selectedMenu === 'services',
      id: 'services',
    },
    {
      name: 'Addons',
      iconType: BiExtension,
      isCurrent: selectedMenu === 'addons',
      id: 'addons',
    },
    {
      name: 'Filters',
      iconType: BiFilterAlt,
      isCurrent: selectedMenu === 'filters',
      id: 'filters',
    },
    ...(mode === 'pro'
      ? ([
          {
            name: 'Sorting',
            iconType: BiSort,
            isCurrent: selectedMenu === 'sorting',
            id: 'sorting' as const,
          },
        ] as MenuItem[])
      : ([] as MenuItem[])),
    {
      name: 'Formatter',
      iconType: BiPen,
      isCurrent: selectedMenu === 'formatter',
      id: 'formatter' as const,
    },
    {
      name: 'Proxy',
      iconType: BiServer,
      isCurrent: selectedMenu === 'proxy',
      id: 'proxy' as const,
    },
    ...(isOptionsEnabled
      ? [
          {
            name: 'Fun',
            iconType: BiSmile,
            isCurrent: selectedMenu === 'fun',
            id: 'fun' as const,
          },
        ]
      : []),
    {
      name: 'Miscellaneous',
      iconType: BiCog,
      isCurrent: selectedMenu === 'miscellaneous',
      id: 'miscellaneous' as const,
    },
    {
      name: 'Save & Install',
      iconType: BiSave,
      isCurrent: selectedMenu === 'save-install',
      id: 'save-install' as const,
    },
  ];

  const handleExpandSidebar = () => {
    if (!ctx.isBelowBreakpoint && ts.expandSidebarOnHover) {
      setExpandSidebar(true);
    }
  };
  const handleUnexpandedSidebar = () => {
    if (expandedSidebar && ts.expandSidebarOnHover) {
      setExpandSidebar(false);
    }
  };

  const ts = {
    expandSidebarOnHover: false,
    disableSidebarTransparency: false,
  };

  return (
    <>
      <AppSidebar
        className={cn(
          'group/main-sidebar h-full flex flex-col justify-between transition-gpu w-full transition-[width] duration-300',
          !ctx.isBelowBreakpoint && expandedSidebar && 'w-[260px]',
          !ctx.isBelowBreakpoint &&
            !ts.disableSidebarTransparency &&
            'bg-transparent',
          !ctx.isBelowBreakpoint &&
            !ts.disableSidebarTransparency &&
            ts.expandSidebarOnHover &&
            'hover:bg-[--background]'
        )}
        onMouseEnter={handleExpandSidebar}
        onMouseLeave={handleUnexpandedSidebar}
      >
        {!ctx.isBelowBreakpoint &&
          ts.expandSidebarOnHover &&
          ts.disableSidebarTransparency && (
            <div
              className={cn(
                'fixed h-full translate-x-0 w-[50px] bg-gradient bg-gradient-to-r via-[--background] from-[--background] to-transparent',
                'group-hover/main-sidebar:translate-x-[250px] transition opacity-0 duration-300 group-hover/main-sidebar:opacity-100'
              )}
            ></div>
          )}

        <div>
          <div className="mb-4 p-4 pb-0 flex flex-col items-center w-full">
            <div
              className="flex items-center gap-2"
              onClick={() => {
                toggleOptions();
              }}
            >
              <img
                src={
                  status?.settings.alternateDesign
                    ? status?.channel === 'nightly'
                      ? '/mini-nightly-white.png'
                      : '/mini-stable-white.png'
                    : user.userData.addonLogo || '/logo.png'
                }
                alt="logo"
                className="max-w-[90px] max-h-[60px] object-contain p-4"
              />
            </div>
            {status?.settings.alternateDesign === false && (
              <span className="text-xs text-gray-500">
                {status
                  ? status.channel === 'nightly'
                    ? 'nightly'
                    : status.tag
                  : ''}
              </span>
            )}
          </div>
          <div
            className={cn('mb-3', isCollapsed ? 'flex justify-center' : 'px-4')}
          >
            {isCollapsed ? (
              <Tooltip
                side="right"
                trigger={
                  <button
                    type="button"
                    onClick={() => {
                      openCommandPalette();
                      ctx.setOpen(false);
                    }}
                    className="group/search flex w-11 h-10 items-center justify-center gap-2 rounded-md border border-[--border] bg-[--subtle]/50 hover:bg-[--subtle] text-[--muted] hover:text-[--foreground] transition-colors px-0"
                    aria-label="Search settings"
                  >
                    <BiSearch className="text-base shrink-0" />
                  </button>
                }
              >
                Search settings ({shortcutLabel})
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={() => {
                  openCommandPalette();
                  ctx.setOpen(false);
                }}
                className="group/search flex w-full h-9 items-center gap-2 rounded-md border border-[--border] bg-[--subtle]/50 hover:bg-[--subtle] text-[--muted] hover:text-[--foreground] transition-colors px-3 text-sm"
                aria-label="Search settings"
              >
                <BiSearch className="text-base shrink-0" />
                <span className="flex-1 text-left">Search settings…</span>
                <kbd className="font-mono text-xs px-1.5 py-0.5 rounded border border-[--border] bg-[--background] text-[--muted] leading-none">
                  {shortcutLabel}
                </kbd>
              </button>
            )}
          </div>
          <VerticalMenu
            className="px-4"
            collapsed={isCollapsed}
            itemClass="relative"
            items={topMenuItems}
            onItemSelect={(item) => {
              setSelectedMenu((item as MenuItem).id);
              ctx.setOpen(false);
            }}
          />
        </div>

        <div className="p-4 gap-2 flex flex-col">
          <Tooltip
            side="right"
            trigger={
              <Button
                intent="alert-outline"
                size="md"
                iconSpacing="0"
                className="w-full"
                iconClass="text-3xl"
                leftIcon={<BiHeart />}
                hideTextOnLargeScreen
                onClick={() => {
                  donationModal.open();
                }}
              >
                <div className="flex items-center gap-2 ml-2">Donate</div>
              </Button>
            }
          >
            Donate
          </Tooltip>
          {/** show a log out button when the user is logged in */}

          {selectedMenu !== 'about' && (
            <div className="hidden lg:block">
              <Tooltip
                side="right"
                trigger={
                  <Button
                    intent="primary-outline"
                    size="md"
                    iconClass="text-3xl"
                    className="w-full "
                    iconSpacing="0"
                    // leftIcon={<BiLogOutCircle />}
                    leftIcon={
                      user.uuid && user.password ? (
                        <BiLogOutCircle />
                      ) : (
                        <BiLogInCircle />
                      )
                    }
                    hideTextOnLargeScreen
                    onClick={() => {
                      // confirmClearConfig.open();
                      if (user.uuid && user.password) {
                        confirmClearConfig.open();
                      } else {
                        signInModal.open();
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 ml-2">
                      {user.uuid && user.password ? 'Sign Out' : 'Sign In'}
                    </div>
                  </Button>
                }
              >
                {user.uuid && user.password ? 'Sign Out' : 'Sign In'}
              </Tooltip>
            </div>
          )}
        </div>
      </AppSidebar>

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
        initialUuid={initialUuid || undefined}
      />

      <ConfirmationDialog {...confirmClearConfig} />
      <DonationModal
        open={donationModal.isOpen}
        onOpenChange={donationModal.toggle}
      />
    </>
  );
}
