'use client';

import { useMenu } from '@/context/menu';
import { ServicesMenu } from './menu/services';
import { AddonsMenu } from './menu/addons';
import { AboutMenu } from './menu/about';
import { FiltersMenu } from './menu/filters';
import { SortingMenu } from './menu/sorting';
import { MiscellaneousMenu } from './menu/miscellaneous';
import { SaveInstallMenu } from './menu/save-install';
import { FormatterMenu } from './menu/formatter';
import { ProxyMenu } from './menu/proxy';
import { OptionsMenu } from './menu/options';

export function MenuContent() {
  const { selectedMenu } = useMenu();

  switch (selectedMenu) {
    case 'about':
      return <AboutMenu />;
    case 'services':
      return <ServicesMenu />;
    case 'addons':
      return <AddonsMenu />;
    case 'filters':
      return <FiltersMenu />;
    case 'sorting':
      return <SortingMenu />;
    case 'formatter':
      return <FormatterMenu />;
    case 'proxy':
      return <ProxyMenu />;
    case 'miscellaneous':
      return <MiscellaneousMenu />;
    case 'save-install':
      return <SaveInstallMenu />;
    case 'fun':
      return <OptionsMenu />;
    default:
      return (
        <div className="p-8">
          <h2 className="text-2xl font-bold mb-4">{selectedMenu}</h2>
          <p className="text-gray-400">This section is under construction.</p>
        </div>
      );
  }
}
