import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAppSidebarContext } from '@/components/ui/app-layout';
import { cn } from '@/components/ui/core/styling';
import type { VerticalMenuItem } from '@/components/ui/vertical-menu';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { CommandPaletteSearchButton } from '@/components/shared/command-palette/search-button';
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
  BiHeart,
  BiLogOutCircle,
  BiLogInCircle,
  BiSearch,
  BiGridAlt,
  BiBarChartAlt2,
} from 'react-icons/bi';
import { useCommandPalette } from '@/context/command-palette';
import { useRegisterQuickAction } from '@/context/quick-actions';
import { useDisclosure } from '@/hooks/disclosure';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { Modal } from '@/components/ui/modal';
import { TextInput } from '@/components/ui/text-input';
import { toast } from 'sonner';
import { Tooltip } from '@/components/ui/tooltip';
import { useMode } from '@/context/mode';
import { DonationModal } from '@/components/shared/donation-modal';
import { useSave } from '@/context/save';

type MenuItem = VerticalMenuItem & {
  id: MenuId;
};

export function MainSidebar() {
  const ctx = useAppSidebarContext();
  const isCollapsed = !ctx.isBelowBreakpoint;
  const navigate = useNavigate();
  const { selectedMenu, setSelectedMenu } = useMenu();
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '';
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
    {
      name: 'Miscellaneous',
      iconType: BiCog,
      isCurrent: selectedMenu === 'miscellaneous',
      id: 'miscellaneous' as const,
    },
    // Stats only renders when (a) the instance owner has per-user analytics
    // on, and (b) the user is signed in. The Stats page itself shows a
    // friendly message in the same conditions, but hiding the menu item
    // avoids surfacing a tab that always says "sign in".
    ...(status?.settings.userAnalyticsEnabled && isSignedIn
      ? ([
          {
            name: 'Stats',
            iconType: BiBarChartAlt2,
            isCurrent: selectedMenu === 'stats',
            id: 'stats' as const,
          },
        ] as MenuItem[])
      : ([] as MenuItem[])),
    {
      name: 'Save & Install',
      iconType: BiSave,
      isCurrent: selectedMenu === 'save-install',
      id: 'save-install' as const,
    },
  ];

  const header = (
    <>
      <div className="mb-4 p-4 pb-0 flex flex-col items-center w-full">
        <div className="flex items-center gap-2">
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
      <CommandPaletteSearchButton
        label="Search settings"
        onOpen={openCommandPalette}
      />
    </>
  );

  const footerItems: VerticalMenuItem[] = [
    {
      name: 'Dashboard',
      iconType: BiGridAlt,
      onClick(e) {
        if (e.ctrlKey || e.metaKey) {
          window.open('/dashboard', '_blank');
        } else {
          navigate({ to: '/dashboard' });
        }
      },
    },
    {
      name: 'Donate',
      iconType: BiHeart,
      onClick: () => donationModal.open(),
    },
    // Sign in/out lives in the mobile top-navbar, so only show it in the
    // sidebar footer on desktop (and never on the About page).
    ...(isCollapsed && selectedMenu !== 'about'
      ? [
          {
            name: isSignedIn ? 'Sign Out' : 'Sign In',
            iconType: isSignedIn ? BiLogOutCircle : BiLogInCircle,
            onClick: () =>
              isSignedIn ? confirmClearConfig.open() : signInModal.open(),
          },
        ]
      : []),
  ];

  return (
    <>
      <Sidebar
        header={header}
        items={topMenuItems}
        footerItems={footerItems}
        onItemSelect={(item) => {
          setSelectedMenu((item as MenuItem).id);
        }}
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
