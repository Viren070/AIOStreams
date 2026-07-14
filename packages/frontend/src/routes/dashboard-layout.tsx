import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import {
  AppLayout,
  AppLayoutContent,
  AppLayoutSidebar,
  AppSidebarProvider,
  AppSidebarTrigger,
} from '@/components/ui/app-layout';
import { Sidebar, SidebarItem } from '@/components/sidebar/Sidebar';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { useSession } from '@/context/session';
import { BiLogOutCircle, BiSliderAlt } from 'react-icons/bi';
import { LayoutHeaderBackground } from '@/components/layout-header-background';
import { NAV, SECTIONED } from '@/app/dashboard/nav';
import {
  DashboardCommandPaletteProvider,
  useDashboardCommandPalette,
} from '@/context/dashboard-command-palette';
import { DashboardCommandPalette } from '@/components/shared/command-palette';
import {
  CommandPaletteSearchButton,
  CommandPaletteTopBarButton,
} from '@/components/shared/command-palette/search-button';

function SidebarHeader() {
  const { open } = useDashboardCommandPalette();
  return (
    <>
      <div className="mb-4 p-4 pb-0 flex flex-col items-center w-full">
        <img
          src="/logo.png"
          alt="AIOStreams"
          className="max-w-[90px] max-h-[60px] object-contain p-4"
        />
        <span className="text-xs text-gray-500 mb-3">Dashboard</span>
      </div>
      <CommandPaletteSearchButton label="Search dashboard" onOpen={open} />
    </>
  );
}

function MobileSearchBar() {
  const { open } = useDashboardCommandPalette();
  return <CommandPaletteTopBarButton label="Search dashboard" onOpen={open} />;
}

export function DashboardLayout() {
  // session is guaranteed by the route's beforeLoad — no loading gate needed
  const { signOut } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const confirmSignOut = useConfirmationDialog({
    title: 'Sign Out',
    description: 'Are you sure you want to sign out?',
    onConfirm: async () => {
      await signOut();
      window.location.href = '/login';
    },
  });

  const items: SidebarItem[] = NAV.map((n) => {
    const sections = SECTIONED[n.href];
    if (sections) {
      const isOn = pathname.startsWith(n.href);
      return {
        name: n.label,
        iconType: n.icon,
        isCurrent: isOn,
        expanded: isOn,
        onClick: () => navigate({ to: n.href }),
        subItems: sections.map((s) => ({
          name: s.label,
          iconType: s.icon,
          isCurrent: pathname === `${n.href}/${s.id}`,
          onClick: () => navigate({ to: `${n.href}/${s.id}` }),
        })),
      };
    }
    return {
      name: n.label,
      iconType: n.icon,
      isCurrent: pathname === n.href || pathname === `${n.href}/`,
      onClick: () => navigate({ to: n.href }),
    };
  });

  const footerItems: SidebarItem[] = [
    {
      name: 'Configure',
      iconType: BiSliderAlt,
      onClick: () => navigate({ to: '/stremio/configure' }),
    },
    {
      name: 'Sign Out',
      iconType: BiLogOutCircle,
      onClick: () => confirmSignOut.open(),
    },
  ];

  return (
    <DashboardCommandPaletteProvider>
      <AppSidebarProvider>
        <AppLayout withSidebar sidebarSize="slim">
          <AppLayoutSidebar>
            <Sidebar
              header={<SidebarHeader />}
              items={items}
              footerItems={footerItems}
            />
          </AppLayoutSidebar>
          <AppLayout>
            <AppLayoutContent>
              <div
                data-dashboard-top-navbar
                className="lg:hidden w-full h-[5rem] relative overflow-hidden flex items-center gap-3 px-4"
              >
                <AppSidebarTrigger />
                <MobileSearchBar />
                <LayoutHeaderBackground />
              </div>
              <Outlet />
            </AppLayoutContent>
          </AppLayout>
        </AppLayout>
        <ConfirmationDialog {...confirmSignOut} />
      </AppSidebarProvider>
      <DashboardCommandPalette />
    </DashboardCommandPaletteProvider>
  );
}
