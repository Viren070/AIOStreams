import React from 'react';
import { t } from '@lingui/core/macro';
import { useAppSidebarContext } from '@aiostreams/ui/app-layout';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  type DropdownMenuProps,
} from '@aiostreams/ui/dropdown-menu';
import { VerticalMenu } from '@aiostreams/ui/vertical-menu';
import type { SidebarItem } from '@aiostreams/ui/shared/sidebar';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '@/lib/jellyfin/session';
import { useOwnAvatar } from '@/lib/jellyfin/history';
import { serverAddress } from '@/lib/jellyfin/servers';
import { useServerInfo } from '@/lib/jellyfin/server-info';
import { useDownloadList } from '@/lib/downloads';
import { UserAvatar } from '@/components/user-avatar';
import { onBar } from './common';

/** The signed-in user's picture, in a sidebar item's icon slot. */
function SidebarAvatar({ className }: { className?: string }) {
  const { user } = useSession();
  const avatar = useOwnAvatar();
  return (
    <UserAvatar
      name={user.Name}
      src={avatar}
      className={cn(className, 'size-6 !text-[0.7rem] !text-white')}
    />
  );
}

/** The avatar, ringed with the progress of running downloads. */
export function YouIcon() {
  const running = useDownloadList().filter(
    (d) => d.state === 'downloading' || d.state === 'queued'
  );
  const total = running.reduce((sum, d) => sum + (d.total ?? 0), 0);
  const bytes = running.reduce((sum, d) => sum + d.bytes, 0);
  return (
    <span className="relative flex">
      <SidebarAvatar />
      {running.length > 0 && (
        <svg
          data-ui="download-ring"
          viewBox="0 0 32 32"
          className="pointer-events-none absolute -inset-1 size-8 -rotate-90"
        >
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            strokeWidth="2.5"
            className="stroke-white/15"
          />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100 - (total ? (bytes / total) * 100 : 0)}
            className="stroke-brand-500 transition-[stroke-dashoffset]"
          />
        </svg>
      )}
    </span>
  );
}

/** The account menu: who is signed in, on which server, and the account actions. */
export function AccountMenu({
  trigger,
  places = [],
  items,
  ...position
}: {
  trigger: React.ReactNode;
  /** Pages listed above the account's actions. */
  places?: SidebarItem[];
  items: SidebarItem[];
} & Pick<DropdownMenuProps, 'side' | 'align' | 'sideOffset'>) {
  const { client, user } = useSession();
  const info = useServerInfo();
  return (
    <DropdownMenu
      data-ui="account-menu"
      {...position}
      className="min-w-52"
      trigger={trigger}
    >
      <DropdownMenuLabel>
        <span className="block truncate">{user.Name ?? t`You`}</span>
        <span className="block truncate text-xs font-normal text-[--muted]">
          {info.name ?? serverAddress(client.base)}
        </span>
      </DropdownMenuLabel>
      {[places, items]
        .filter((group) => group.length)
        .map((group, i) => (
          <React.Fragment key={i}>
            <DropdownMenuSeparator />
            {group.map((item) => {
              const Icon = item.iconType;
              return (
                <DropdownMenuItem
                  key={item.name}
                  data-ui={group === places ? 'account-menu-page' : undefined}
                  data-name={item.id}
                  data-shown={(group === places && onBar(item)) || undefined}
                  onClick={item.onClick}
                >
                  {Icon && <Icon className="text-lg" />}
                  {item.name}
                </DropdownMenuItem>
              );
            })}
          </React.Fragment>
        ))}
    </DropdownMenu>
  );
}

/** The avatar at the foot of the sidebar, styled as its other items. */
export function SidebarAccount({ you }: { you: SidebarItem }) {
  const { user } = useSession();
  const sidebar = useAppSidebarContext();
  return (
    <VerticalMenu
      collapsed={!sidebar.isBelowBreakpoint}
      isSidebar
      itemClass="relative"
      items={[
        {
          id: 'account',
          name: user.Name ?? t`You`,
          iconType: SidebarAvatar,
          onClick: you.onClick,
        },
      ]}
    />
  );
}
