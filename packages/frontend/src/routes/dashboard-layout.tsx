import React from 'react';
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
import {
  BiBarChartAlt2,
  BiListUl,
  BiServer,
  BiCog,
  BiNetworkChart,
  BiLogOutCircle,
  BiGridAlt,
  BiGroup,
  BiTask,
  BiData,
  BiSliderAlt,
  BiCloudDownload,
  BiBlock,
  BiSearch,
} from 'react-icons/bi';
import { LayoutHeaderBackground } from '@/components/layout-header-background';
import { SECTIONS } from '@/app/dashboard/usenet/sections';
import { BLOCKLIST_SECTIONS } from '@/app/dashboard/blocklist/sections';
import type { DashboardSection } from '@/components/shared/section-nav-select';
import {
  DashboardCommandPaletteProvider,
  useDashboardCommandPalette,
} from '@/context/dashboard-command-palette';
import { DashboardCommandPalette } from '@/components/shared/dashboard-command-palette';
import { Tooltip } from '@/components/ui/tooltip';

// Order mirrors how operators typically navigate the dashboard: dashboards
// at the top, operational tools in the middle, infrastructure (Proxy) before
// the dangerous Settings page which lives last.
const NAV: {
  label: string;
  href: string;
  icon: React.ElementType;
}[] = [
  { label: 'Overview', href: '/dashboard', icon: BiGridAlt },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BiBarChartAlt2 },
  { label: 'Logs', href: '/dashboard/logs', icon: BiListUl },
  { label: 'System', href: '/dashboard/system', icon: BiServer },
  { label: 'Users', href: '/dashboard/users', icon: BiGroup },
  { label: 'Tasks', href: '/dashboard/tasks', icon: BiTask },
  { label: 'Cache', href: '/dashboard/cache', icon: BiData },
  // The Usenet item expands into an inline accordion of its sub-sections
  // (wired up in the items mapping below).
  { label: 'Usenet', href: '/dashboard/usenet', icon: BiCloudDownload },
  { label: 'Blocklists', href: '/dashboard/blocklist', icon: BiBlock },
  { label: 'Proxy', href: '/dashboard/proxy', icon: BiNetworkChart },
  { label: 'Settings', href: '/dashboard/settings', icon: BiCog },
];

// Nav items that expand into an inline accordion of sub-sections, each a
// child route (`<href>/<section>`). The header navigates to the base path
// (which redirects to the default section).
const SECTIONED: Record<string, readonly DashboardSection[]> = {
  '/dashboard/usenet': SECTIONS,
  '/dashboard/blocklist': BLOCKLIST_SECTIONS,
};

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

  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl K';

  function SidebarHeader() {
    const { open: openCommandPalette } = useDashboardCommandPalette();
    return (
      <div className="mb-4 p-4 pb-0 flex flex-col items-center w-full">
        <img
          src="/logo.png"
          alt="AIOStreams"
          className="max-w-[90px] max-h-[60px] object-contain p-4"
        />
        <span className="text-xs text-gray-500 mb-3">Dashboard</span>
        <Tooltip
          side="right"
          trigger={
            <button
              type="button"
              onClick={() => openCommandPalette()}
              className="group/search flex w-11 h-10 items-center justify-center gap-2 rounded-md border border-[--border] bg-[--subtle]/50 hover:bg-[--subtle] text-[--muted] hover:text-[--foreground] transition-colors px-0"
              aria-label="Search dashboard"
            >
              <BiSearch className="text-base shrink-0" />
            </button>
          }
        >
          Search dashboard ({shortcutLabel})
        </Tooltip>
      </div>
    );
  }

  function MobileSearchBar() {
    const { open: openCommandPalette } = useDashboardCommandPalette();
    return (
      <button
        type="button"
        onClick={() => openCommandPalette()}
        aria-label="Search dashboard"
        className="flex-1 flex items-center gap-2 h-9 px-3 rounded-md border border-[--border] bg-[--subtle]/50 hover:bg-[--subtle] text-[--muted] hover:text-[--foreground] transition-colors text-sm truncate"
      >
        <BiSearch className="text-base shrink-0" />
        <span className="flex-1 text-left">Search dashboard…</span>
      </button>
    );
  }

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
            <Sidebar header={<SidebarHeader />} items={items} footerItems={footerItems} />
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
