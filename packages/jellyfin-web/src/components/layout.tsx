import React from 'react';
import { motion } from 'motion/react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import {
  BiCompass,
  BiHistory,
  BiHomeAlt2,
  BiLogOutCircle,
  BiCog,
  BiSearch,
  BiServer,
  BiSliderAlt,
  BiTransferAlt,
} from 'react-icons/bi';
import {
  AppLayout,
  AppLayoutContent,
  AppLayoutSidebar,
  AppSidebarProvider,
} from '@aiostreams/ui/app-layout';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@aiostreams/ui/dropdown-menu';
import { Sidebar, type SidebarItem } from '@aiostreams/ui/shared/sidebar';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { usePickableUsers } from '../lib/queries';
import { configureUrl, navigate, to } from '../lib/paths';
import { UserAvatar } from './user-avatar';
import { BrandLogo, useBranding } from './brand-logo';
import { VersionPickerProvider } from './version-picker';

const PAGE_FADE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring', damping: 28, stiffness: 260, mass: 0.7 },
} as const;

function Logo() {
  return (
    <div className="mb-4 flex w-full justify-center p-4 pb-0">
      <BrandLogo className="max-h-[60px] max-w-[90px] object-contain p-4" />
    </div>
  );
}

/** The signed-in user's picture, in a sidebar item's icon slot. */
function SidebarAvatar({ className }: { className?: string }) {
  const { user } = useSession();
  const users = usePickableUsers();
  const avatar = users.data?.find((u) => u.user.Id === user.Id)?.avatar ?? null;
  return (
    <UserAvatar
      name={user.Name}
      src={avatar}
      className={cn(className, 'size-6 !text-[0.7rem] !text-white')}
    />
  );
}

/**
 * The backdrop as one element that never fades with the screens, so a
 * transparent page shows nothing beneath it; the player hides it.
 */
export function PageBackground() {
  return (
    <div
      aria-hidden
      className="page-background pointer-events-none fixed inset-0 -z-10 bg-[--background]"
    />
  );
}

export function WebLayout() {
  const { client, signOut, switchUser, changeServer, user } = useSession();
  const configure = configureUrl(client.base, useBranding());
  const users = usePickableUsers();
  const several = (users.data?.length ?? 0) > 1;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const confirmSignOut = useConfirmationDialog({
    title: 'Sign out',
    description: __STANDALONE__
      ? 'Sign out of this server?'
      : 'Sign out of this browser?',
    actionText: 'Sign out',
    onConfirm: signOut,
  });

  const items: SidebarItem[] = [
    {
      name: 'Home',
      iconType: BiHomeAlt2,
      isCurrent: pathname === '/',
      onClick: () => navigate(to.home),
    },
    {
      name: 'Discover',
      iconType: BiCompass,
      isCurrent:
        pathname.startsWith('/discover') || pathname.startsWith('/library'),
      onClick: () => navigate(to.discover()),
    },
    {
      name: 'Search',
      iconType: BiSearch,
      isCurrent: pathname.startsWith('/search'),
      onClick: () => navigate(to.search()),
    },
    {
      name: 'Activity',
      iconType: BiHistory,
      isCurrent: pathname.startsWith('/history'),
      onClick: () => navigate(to.history),
    },
  ];

  const accountItems: SidebarItem[] = [
    {
      name: 'Settings',
      iconType: BiCog,
      isCurrent: pathname.startsWith('/settings'),
      onClick: () => navigate(to.settings()),
    },
    ...(configure
      ? [
          {
            name: 'Configure',
            iconType: BiSliderAlt,
            onClick: () => window.open(configure, '_blank'),
          },
        ]
      : []),
    ...(changeServer
      ? [{ name: 'Change server', iconType: BiServer, onClick: changeServer }]
      : []),
    {
      name: 'Sign out',
      iconType: BiLogOutCircle,
      onClick: () => confirmSignOut.open(),
    },
  ];

  const footerItems: SidebarItem[] = [
    ...accountItems,
    {
      name: several
        ? `${user.Name ?? 'You'}: switch user`
        : (user.Name ?? 'You'),
      iconType: SidebarAvatar,
      onClick: several ? switchUser : undefined,
    },
  ];

  const menuItems: SidebarItem[] = [
    ...(several
      ? [{ name: 'Switch user', iconType: BiTransferAlt, onClick: switchUser }]
      : []),
    ...accountItems,
  ];

  return (
    <AppSidebarProvider>
      <AppLayout withSidebar sidebarSize="slim">
        <AppLayoutSidebar>
          <Sidebar header={<Logo />} items={items} footerItems={footerItems} />
        </AppLayoutSidebar>
        <AppLayout>
          <AppLayoutContent>
            <VersionPickerProvider>
              <motion.div
                key={pathname}
                {...PAGE_FADE}
                className="pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] max-lg:pb-[calc(5rem+env(safe-area-inset-bottom))]"
              >
                <Outlet />
              </motion.div>
            </VersionPickerProvider>
          </AppLayoutContent>
        </AppLayout>
      </AppLayout>
      <MobileNav items={items} menuItems={menuItems} />
      <ConfirmationDialog {...confirmSignOut} />
    </AppSidebarProvider>
  );
}

function MobileNav({
  items,
  menuItems,
}: {
  items: SidebarItem[];
  menuItems: SidebarItem[];
}) {
  const { user } = useSession();
  const tab =
    'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-1.5 text-[0.65rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60';
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full border border-white/10 bg-gray-950/80 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
        {items.map((item) => {
          const Icon = item.iconType;
          return (
            <button
              key={item.name}
              type="button"
              aria-current={item.isCurrent ? 'page' : undefined}
              onClick={(e) => {
                (document.activeElement as HTMLElement | null)?.blur();
                item.onClick?.(e);
              }}
              className={cn(
                tab,
                item.isCurrent
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {Icon && <Icon className="text-xl" />}
              <span className="truncate">{item.name}</span>
            </button>
          );
        })}
        <DropdownMenu
          side="top"
          align="end"
          sideOffset={12}
          className="min-w-52"
          trigger={
            <button
              type="button"
              aria-label="Account"
              className={cn(tab, 'text-gray-400 hover:text-white')}
            >
              <SidebarAvatar />
              <span className="max-w-full truncate">You</span>
            </button>
          }
        >
          <DropdownMenuLabel className="truncate">
            {user.Name ?? 'You'}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {menuItems.map((item) => {
            const Icon = item.iconType;
            return (
              <DropdownMenuItem key={item.name} onClick={item.onClick}>
                {Icon && <Icon className="text-lg" />}
                {item.name}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu>
      </div>
    </nav>
  );
}

/** The padded column a page renders into. */
export function PageBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-[1] space-y-8 px-4 pb-16 pt-[calc(1.5rem+env(safe-area-inset-top))] lg:px-10 lg:pt-[calc(2.5rem+env(safe-area-inset-top))]">
      {children}
    </div>
  );
}
