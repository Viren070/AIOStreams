import type React from 'react';
import {
  BiGridAlt,
  BiBarChartAlt2,
  BiListUl,
  BiServer,
  BiGroup,
  BiTask,
  BiData,
  BiCloudDownload,
  BiBlock,
  BiNetworkChart,
  BiCog,
} from 'react-icons/bi';
import { SECTIONS } from '@/app/dashboard/usenet/sections';
import { BLOCKLIST_SECTIONS } from '@/app/dashboard/blocklist/sections';
import type { DashboardSection } from '@/components/shared/section-nav-select';

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

/**
 * The dashboard's top-level navigation.
 */
export const NAV: DashboardNavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: BiGridAlt },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BiBarChartAlt2 },
  { label: 'Logs', href: '/dashboard/logs', icon: BiListUl },
  { label: 'System', href: '/dashboard/system', icon: BiServer },
  { label: 'Users', href: '/dashboard/users', icon: BiGroup },
  { label: 'Tasks', href: '/dashboard/tasks', icon: BiTask },
  { label: 'Cache', href: '/dashboard/cache', icon: BiData },
  { label: 'Usenet', href: '/dashboard/usenet', icon: BiCloudDownload },
  { label: 'Blocklists', href: '/dashboard/blocklist', icon: BiBlock },
  { label: 'Proxy', href: '/dashboard/proxy', icon: BiNetworkChart },
  { label: 'Settings', href: '/dashboard/settings', icon: BiCog },
];

/**
 * Nav items that expand into sub-sections, each a child route
 * (`<href>/<section>`). The header navigates to the base path, which redirects
 * to the default section.
 */
export const SECTIONED: Record<string, readonly DashboardSection[]> = {
  '/dashboard/usenet': SECTIONS,
  '/dashboard/blocklist': BLOCKLIST_SECTIONS,
};
