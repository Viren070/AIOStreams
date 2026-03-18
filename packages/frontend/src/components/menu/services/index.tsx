'use client';
import { useState, useEffect } from 'react';
import { PageWrapper } from '../../shared/page-wrapper';
import { PageControls } from '../../shared/page-controls';
import { MenuTabs } from '../../shared/menu-tabs';
import { useMode } from '@/context/mode';
import { FiServer, FiSettings, FiDatabase, FiImage } from 'react-icons/fi';
import { StreamServices } from './_components/stream-services';
import { BuiltinSettings } from './_components/builtin-settings';
import { MetadataServices } from './_components/metadata-services';
import { PosterServices } from './_components/poster-services';

export function ServicesMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { mode } = useMode();
  const [activeTab, setActiveTab] = useState('services');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('service-tab');
    if (tab && ['services', 'builtin', 'metadata', 'posters'].includes(tab)) {
      setActiveTab(tab);
    }
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(window.location.search);
    params.set('service-tab', value);
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${params.toString()}`
    );
  };

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Services</h2>
          <p className="text-[--muted]">
            Configure your debrid, metadata, and poster services.
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <MenuTabs
        tabs={[
          {
            value: 'services',
            label: 'Services',
            icon: <FiServer className="w-4 h-4 shrink-0" />,
            content: <StreamServices />,
          },
          {
            value: 'builtin',
            label: 'Built-in',
            icon: <FiSettings className="w-4 h-4 shrink-0" />,
            content:
              mode === 'pro' ? (
                <BuiltinSettings />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <FiSettings className="w-10 h-10 text-[--muted]" />
                  <p className="text-lg font-semibold">
                    Advanced Mode Required
                  </p>
                  <p className="text-sm text-[--muted]">
                    Built-in addon settings are only available in Advanced mode.
                  </p>
                </div>
              ),
          },
          {
            value: 'metadata',
            label: 'Metadata',
            icon: <FiDatabase className="w-4 h-4 shrink-0" />,
            content: <MetadataServices />,
          },
          {
            value: 'posters',
            label: 'Posters',
            icon: <FiImage className="w-4 h-4 shrink-0" />,
            content: <PosterServices />,
          },
        ]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        defaultMobileOpen="services"
      />
    </>
  );
}
