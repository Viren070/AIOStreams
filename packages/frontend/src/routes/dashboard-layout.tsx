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
} from 'react-icons/bi';
import { LayoutHeaderBackground } from '@/components/layout-header-background';

// Order mirrors how operators typically navigate the dashboard: dashboards
// at the top, operational tools in the middle, infrastructure (Proxy) before
// the dangerous Settings page which lives last.
const NAV: { label: string; href: string; icon: React.ElementType }[] = [
  { label: 'Overview', href: '/dashboard', icon: BiGridAlt },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BiBarChartAlt2 },
  { label: 'Logs', href: '/dashboard/logs', icon: BiListUl },
  { label: 'System', href: '/dashboard/system', icon: BiServer },
  { label: 'Users', href: '/dashboard/users', icon: BiGroup },
  { label: 'Tasks', href: '/dashboard/tasks', icon: BiTask },
  { label: 'Cache', href: '/dashboard/cache', icon: BiData },
  { label: 'Proxy', href: '/dashboard/proxy', icon: BiNetworkChart },
  { label: 'Settings', href: '/dashboard/settings', icon: BiCog },
];

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

  const items: SidebarItem[] = NAV.map((n) => ({
    name: n.label,
    iconType: n.icon,
    isCurrent: pathname === n.href || pathname === `${n.href}/`,
    onClick: () => navigate({ to: n.href }),
  }));

  const header = (
    <div className="mb-4 p-4 pb-0 flex flex-col items-center w-full">
      <img
        src="/logo.png"
        alt="AIOStreams"
        className="max-w-[90px] max-h-[60px] object-contain p-4"
      />
      <span className="text-xs text-gray-500">Dashboard</span>
    </div>
  );

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
    <AppSidebarProvider>
      <AppLayout withSidebar sidebarSize="slim">
        <AppLayoutSidebar>
          <Sidebar header={header} items={items} footerItems={footerItems} />
        </AppLayoutSidebar>
        <AppLayout>
          <AppLayoutContent>
            <div
              data-dashboard-top-navbar
              className="lg:hidden w-full h-[5rem] relative overflow-hidden flex items-center gap-3 px-4"
            >
              <AppSidebarTrigger />
              <span className="text-sm font-medium text-[--muted]">
                Dashboard
              </span>
              <LayoutHeaderBackground />
            </div>
            <Outlet />
          </AppLayoutContent>
        </AppLayout>
      </AppLayout>
      <ConfirmationDialog {...confirmSignOut} />
    </AppSidebarProvider>
  );
}
