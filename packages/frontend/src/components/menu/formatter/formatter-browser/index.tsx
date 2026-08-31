import React, { useMemo, useState } from 'react';
import { Bookmark, Layers, Users } from 'lucide-react';
import * as constants from '../../../../../../core/src/utils/constants';
import {
  BUILTIN_FORMATTER_DEFINITIONS,
  FormatterDefinition,
} from '../../../../../../core/src/utils/formatter-definitions';
import { useUserData } from '@/context/userData';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { MenuTabs } from '../../../shared/menu-tabs';
import { getActiveSavedName } from '../templates';
import { FormatterCard } from './formatter-card';
import { SavedTab } from './saved-tab';
import { CommunityTab } from './community-tab';
import { useCardPreviews } from './use-card-previews';

export interface FormatterBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectBuiltin: (id: constants.FormatterType) => void;
  onSelectSaved: (name: string) => void;
  onSelectCustom: () => void;
  onSaveCurrent: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
  onInstall: (name: string, definition: FormatterDefinition) => void;
}

const BUILTIN_IDS = constants.FORMATTERS.filter(
  (id) => id !== constants.CUSTOM_FORMATTER
);

export function FormatterBrowser({
  open,
  onOpenChange,
  onSelectBuiltin,
  onSelectSaved,
  onSelectCustom,
  onSaveCurrent,
  onRename,
  onDelete,
  onInstall,
}: FormatterBrowserProps) {
  const { userData } = useUserData();
  const [activeTab, setActiveTab] = useState('builtin');

  const currentId = userData.formatter.id;
  const definitions = userData.formatter.definitions;
  const overrides = definitions?.overrides;
  const saved = definitions?.saved;
  const custom = definitions?.custom;
  const activeSaved = getActiveSavedName(userData);
  const customActive = currentId === constants.CUSTOM_FORMATTER && !activeSaved;

  // Deps are the userData references themselves: a `?? {}` fallback here would
  // be a new object every render and re-fire the preview effect endlessly.
  const cardDefinitions = useMemo(() => {
    const out: Record<string, FormatterDefinition> = {};
    for (const id of BUILTIN_IDS) {
      const definition = overrides?.[id] ?? BUILTIN_FORMATTER_DEFINITIONS[id];
      if (definition) out[id] = definition;
    }
    for (const [name, definition] of Object.entries(saved ?? {})) {
      out[`saved:${name}`] = definition;
    }
    if (custom) out.custom = custom;
    return out;
  }, [overrides, saved, custom]);

  const previews = useCardPreviews(cardDefinitions, open);

  const builtinTab = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[560px] overflow-y-auto pr-2">
      {BUILTIN_IDS.map((id) => {
        const detail = constants.FORMATTER_DETAILS[id];
        const active = currentId === id;
        const customised = !!overrides?.[id];
        return (
          <FormatterCard
            key={id}
            title={detail.name}
            description={detail.description}
            preview={previews[id]}
            active={active}
            badge={
              customised ? (
                <span className="text-xs bg-yellow-400/20 text-yellow-400 px-2 py-0.5 rounded border border-yellow-400/30">
                  Customised
                </span>
              ) : undefined
            }
            actions={
              <Button
                size="sm"
                intent={active ? 'gray-outline' : 'primary-subtle'}
                disabled={active}
                onClick={() => onSelectBuiltin(id)}
              >
                {active ? 'In use' : 'Use'}
              </Button>
            }
          />
        );
      })}
      <FormatterCard
        title={constants.FORMATTER_DETAILS[constants.CUSTOM_FORMATTER].name}
        description={
          constants.FORMATTER_DETAILS[constants.CUSTOM_FORMATTER].description
        }
        preview={
          custom
            ? previews.custom
            : { name: 'Start from the active formatter', description: '' }
        }
        active={customActive}
        actions={
          <Button
            size="sm"
            intent={customActive ? 'gray-outline' : 'primary-subtle'}
            disabled={customActive}
            onClick={onSelectCustom}
          >
            {customActive ? 'In use' : 'Use'}
          </Button>
        }
      />
    </div>
  );

  const tabs = [
    {
      value: 'builtin',
      label: 'Built-in',
      icon: <Layers className="w-4 h-4" />,
      content: builtinTab,
    },
    {
      value: 'saved',
      label: `Saved (${Object.keys(saved ?? {}).length})`,
      icon: <Bookmark className="w-4 h-4" />,
      content: (
        <SavedTab
          saved={saved ?? {}}
          previews={previews}
          activeName={activeSaved}
          onSelect={onSelectSaved}
          onSaveCurrent={onSaveCurrent}
          onRename={onRename}
          onDelete={onDelete}
        />
      ),
    },
    {
      value: 'community',
      label: 'Community',
      icon: <Users className="w-4 h-4" />,
      content: (
        <CommunityTab
          enabled={open && activeTab === 'community'}
          onInstall={onInstall}
        />
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Formatters"
      description="Pick a built-in formatter, one you saved, or one shared by the community. Previews use the sample from the preview panel."
      contentClass="max-w-5xl w-full"
    >
      <MenuTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
    </Modal>
  );
}
