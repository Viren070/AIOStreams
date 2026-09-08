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
  BiPlayCircle,
  BiCog,
  BiShareAlt,
} from 'react-icons/bi';
import { SECTIONS } from '@/app/dashboard/usenet/sections';
import { BLOCKLIST_SECTIONS } from '@/app/dashboard/blocklist/sections';
import { STREAMS_SECTIONS } from '@/app/dashboard/streams/sections';
import { COMMUNITY_SECTIONS } from '@/app/dashboard/community/sections';
import type { DashboardSection } from '@/components/shared/section-nav-select';

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  desc?: string;
}

/**
 * The dashboard's top-level navigation.
 */
export const NAV: DashboardNavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: BiGridAlt },
  {
    label: 'Analytics',
    href: '/dashboard/analytics',
    icon: BiBarChartAlt2,
    desc: 'User & request trends',
  },
  {
    label: 'Logs',
    href: '/dashboard/logs',
    icon: BiListUl,
    desc: 'Live log stream',
  },
  {
    label: 'System',
    href: '/dashboard/system',
    icon: BiServer,
    desc: 'CPU, memory & lifecycle',
  },
  {
    label: 'Users',
    href: '/dashboard/users',
    icon: BiGroup,
    desc: 'Accounts & their configs',
  },
  {
    label: 'Tasks',
    href: '/dashboard/tasks',
    icon: BiTask,
    desc: 'Scheduled & manual work',
  },
  {
    label: 'Cache',
    href: '/dashboard/cache',
    icon: BiData,
    desc: 'Cache stats & flush',
  },
  {
    label: 'Streams',
    href: '/dashboard/streams',
    icon: BiPlayCircle,
    desc: 'Active, history & bandwidth',
  },
  {
    label: 'Usenet',
    href: '/dashboard/usenet',
    icon: BiCloudDownload,
    desc: 'Library, providers & stats',
  },
  {
    label: 'Blocklists',
    href: '/dashboard/blocklist',
    icon: BiBlock,
    desc: 'Sources, entries & publishing',
  },
  {
    label: 'Community',
    href: '/dashboard/community',
    icon: BiShareAlt,
    desc: 'Shared formatters & templates',
  },
  {
    label: 'Settings',
    href: '/dashboard/settings',
    icon: BiCog,
    desc: 'Runtime configuration',
  },
];

/** Typed as `string` so router link props don't try to match a literal path. */
export function sectionHref(base: string, id: string): string {
  return `${base}/${id}`;
}

/**
 * Nav items that expand into sub-sections, each a child route
 * (`<href>/<section>`). The header navigates to the base path, which redirects
 * to the default section.
 */
export const SECTIONED: Record<string, readonly DashboardSection[]> = {
  '/dashboard/streams': STREAMS_SECTIONS,
  '/dashboard/usenet': SECTIONS,
  '/dashboard/blocklist': BLOCKLIST_SECTIONS,
  '/dashboard/community': COMMUNITY_SECTIONS,
};
