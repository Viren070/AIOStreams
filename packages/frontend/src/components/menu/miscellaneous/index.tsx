'use client';
import { PageWrapper } from '../../shared/page-wrapper';
import { PageControls } from '../../shared/page-controls';
import { MenuTabs } from '../../shared/menu-tabs';
import { useMode } from '@/context/mode';
import { useSubTab } from '@/context/sub-tab';
import { FaRocket, FaPlay, FaEye } from 'react-icons/fa';
import { FiSettings, FiLink } from 'react-icons/fi';
import { BackgroundOptimization } from './_components/background-optimization';
import { PlaybackBehavior } from './_components/playback-behavior';
import { DisplayDebug } from './_components/display-debug';
import { ParentConfig } from './_components/parent-config';

export function MiscellaneousMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { mode } = useMode();
  const { tab: activeTab, setTab: handleTabChange } = useSubTab('miscellaneous');

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Miscellaneous</h2>
          <p className="text-[--muted]">
            Additional settings and configurations.
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <MenuTabs
        tabs={[
          {
            value: 'background',
            label: 'Background',
            icon: <FaRocket className="w-4 h-4" />,
            content: <BackgroundOptimization />,
          },
          {
            value: 'playback',
            label: 'Playback',
            icon: <FaPlay className="w-4 h-4" />,
            content:
              mode === 'pro' ? (
                <PlaybackBehavior />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <FiSettings className="w-10 h-10 text-[--muted]" />
                  <p className="text-lg font-semibold">
                    Advanced Mode Required
                  </p>
                  <p className="text-sm text-[--muted]">
                    Playback settings are only available in Advanced mode.
                  </p>
                </div>
              ),
          },
          {
            value: 'display',
            label: 'Display',
            icon: <FaEye className="w-4 h-4" />,
            content:
              mode === 'pro' ? (
                <DisplayDebug />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <FiSettings className="w-10 h-10 text-[--muted]" />
                  <p className="text-lg font-semibold">
                    Advanced Mode Required
                  </p>
                  <p className="text-sm text-[--muted]">
                    Display settings are only available in Advanced mode.
                  </p>
                </div>
              ),
          },
          {
            value: 'parent',
            label: 'Parent Config',
            icon: <FiLink className="w-4 h-4" />,
            content: <ParentConfig />,
          },
        ]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
    </>
  );
}
