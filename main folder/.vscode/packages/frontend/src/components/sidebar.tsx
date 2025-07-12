'use client';

import { useStatus } from '../context/status';
import { VerticalMenu } from './ui/vertical-menu/vertical-menu';
import Image from 'next/image';
import { ReactNode } from 'react';
import {
  FunnelIcon,
  SortAscIcon,
  CloudIcon,
  PuzzleIcon,
  SettingsIcon,
  SaveIcon,
  ImportIcon,
  InfoIcon,
} from 'lucide-react';

const menuItems = [
  {
    name: 'Services',
    iconType: CloudIcon,
    isCurrent: true,
  },
  {
    name: 'Addons',
    iconType: PuzzleIcon,
  },
  {
    name: 'Filters',
    iconType: FunnelIcon,
  },
  {
    name: 'Sorting',
    iconType: SortAscIcon,
  },
  {
    name: 'Miscellaneous',
    iconType: SettingsIcon,
  },
  {
    name: 'Save & Install',
    iconType: SaveIcon,
  },
  {
    name: 'Import/Export',
    iconType: ImportIcon,
  },
  {
    name: 'About',
    iconType: InfoIcon,
  },
];

export default function SidebarLayout({ children }: { children: ReactNode }) {
  const { status } = useStatus();

  return (
    <div className="flex h-screen">
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="h-24 flex flex-col items-center justify-center border-b border-gray-800 gap-1">
          <Image
            src="/logo.png"
            alt="Logo"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <div className="text-sm text-gray-400">v{status?.version}</div>
        </div>
        <nav className="flex-1 p-4">
          <VerticalMenu
            items={menuItems}
            onItemSelect={(item) => {
              console.log(`Selected ${item.name}`);
              // Handle navigation here
            }}
          />
        </nav>
      </aside>
      <main className="flex-1 bg-gray-100 overflow-auto">{children}</main>
    </div>
  );
}
