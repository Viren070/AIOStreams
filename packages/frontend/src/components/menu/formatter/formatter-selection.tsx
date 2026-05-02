'use client';
import React from 'react';
import * as constants from '../../../../../core/src/utils/constants';
import { BUILTIN_FORMATTER_DEFINITIONS } from '../../../../../core/src/utils/formatter-definitions';
import { useUserData } from '@/context/userData';
import { UserData } from '@aiostreams/core';
import { SettingsCard } from '../../shared/settings-card';
import { Select } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { Button } from '../../ui/button';
import { IconButton } from '../../ui/button';
import { Tooltip } from '../../ui/tooltip';
import { ImportModal } from '../../shared/import-modal';
import { useDisclosure } from '@/hooks/disclosure';
import { toast } from 'sonner';
import { FaFileImport, FaFileExport, FaSave } from 'react-icons/fa';
import { SnippetsButton } from './snippets-button';
import { SavedFormattersModal } from './saved-formatters-modal';

const formatterChoices = Object.values(constants.FORMATTER_DETAILS);

// Read the active name/description templates from userData — single source of truth.
function getTemplates(data: UserData): { name: string; description: string } {
  const id = data.formatter.id;
  const defs = data.formatter.definitions;
  if (id === constants.CUSTOM_FORMATTER) {
    return {
      name: defs?.custom?.name ?? '',
      description: defs?.custom?.description ?? '',
    };
  }
  const override = defs?.overrides?.[id];
  if (override)
    return { name: override.name, description: override.description };
  const builtin = BUILTIN_FORMATTER_DEFINITIONS[id];
  return { name: builtin?.name ?? '', description: builtin?.description ?? '' };
}

// Write name+description back into userData for whatever formatter is currently active.
function applyTemplates(
  prev: UserData,
  name: string,
  description: string
): UserData {
  const id = prev.formatter.id;
  if (id === constants.CUSTOM_FORMATTER) {
    return {
      ...prev,
      formatter: {
        ...prev.formatter,
        definitions: {
          ...prev.formatter.definitions,
          custom: { name, description },
        },
      },
    };
  }
  const builtin = BUILTIN_FORMATTER_DEFINITIONS[id];
  const matchesBuiltin =
    !!builtin && name === builtin.name && description === builtin.description;
  const nextOverrides = { ...(prev.formatter.definitions?.overrides ?? {}) };
  if (matchesBuiltin) {
    delete nextOverrides[id];
  } else {
    nextOverrides[id] = { name, description };
  }
  return {
    ...prev,
    formatter: {
      ...prev.formatter,
      definitions: {
        ...prev.formatter.definitions,
        overrides:
          Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
      },
    },
  };
}

export function FormatterSelection() {
  const { userData, setUserData } = useUserData();
  const importModalDisclosure = useDisclosure(false);
  const savedModalDisclosure = useDisclosure(false);

  const currentId = userData.formatter.id;
  const definitions = userData.formatter.definitions;

  // Derived directly from userData — no local mirror state needed.
  const { name: nameTemplate, description: descriptionTemplate } =
    getTemplates(userData);
  const isCustomised =
    currentId !== constants.CUSTOM_FORMATTER &&
    !!definitions?.overrides?.[currentId];
  const savedDefinitions = definitions?.saved ?? {};
  const showTemplates =
    currentId === constants.CUSTOM_FORMATTER ||
    !!BUILTIN_FORMATTER_DEFINITIONS[currentId];

  function handleIdChange(newId: string) {
    const typedId = newId as constants.FormatterType;
    setUserData((prev) => {
      // When switching to custom with no existing definition, seed it from whatever is active now.
      if (
        typedId === constants.CUSTOM_FORMATTER &&
        !prev.formatter.definitions?.custom
      ) {
        const { name, description } = getTemplates(prev);
        return {
          ...prev,
          formatter: {
            ...prev.formatter,
            id: typedId,
            definitions: {
              ...prev.formatter.definitions,
              custom: { name, description },
            },
          },
        };
      }
      return { ...prev, formatter: { ...prev.formatter, id: typedId } };
    });
  }

  function handleReset() {
    setUserData((prev) => {
      const id = prev.formatter.id;
      const nextOverrides = {
        ...(prev.formatter.definitions?.overrides ?? {}),
      };
      delete nextOverrides[id];
      return {
        ...prev,
        formatter: {
          ...prev.formatter,
          definitions: {
            ...prev.formatter.definitions,
            overrides:
              Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
          },
        },
      };
    });
  }

  function handleExport() {
    const data = { name: nameTemplate, description: descriptionTemplate };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'formatter.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Formatter exported successfully');
  }

  function handleImport(data: any) {
    if (typeof data.name === 'string' && typeof data.description === 'string') {
      setUserData((prev) => applyTemplates(prev, data.name, data.description));
      toast.success('Formatter imported successfully');
    } else {
      toast.error('Invalid formatter format');
    }
  }

  function handleSaveCurrentFormatter(savedName: string) {
    const name = savedName.trim();
    if (!name) {
      toast.error('Please enter a name');
      return;
    }
    setUserData((prev) => {
      const { name: tName, description: tDesc } = getTemplates(prev);
      return {
        ...prev,
        formatter: {
          ...prev.formatter,
          definitions: {
            ...prev.formatter.definitions,
            saved: {
              ...(prev.formatter.definitions?.saved ?? {}),
              [name]: { name: tName, description: tDesc },
            },
          },
        },
      };
    });
    toast.success('Formatter saved');
  }

  function handleLoadSavedFormatter(savedName: string) {
    setUserData((prev) => {
      const saved = prev.formatter.definitions?.saved?.[savedName];
      if (!saved) return prev;
      return applyTemplates(prev, saved.name, saved.description);
    });
    toast.success(`Loaded "${savedName}"`);
  }

  function handleRenameSavedFormatter(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty');
      return;
    }
    if (trimmed === oldName) return;
    if (savedDefinitions[trimmed]) {
      toast.error('A saved formatter with this name already exists');
      return;
    }
    setUserData((prev) => {
      const saved = prev.formatter.definitions?.saved ?? {};
      if (!saved[oldName]) return prev;
      const entries = Object.entries(saved).map(([k, v]) =>
        k === oldName ? [trimmed, v] : [k, v]
      );
      return {
        ...prev,
        formatter: {
          ...prev.formatter,
          definitions: {
            ...prev.formatter.definitions,
            saved: Object.fromEntries(entries),
          },
        },
      };
    });
    toast.success('Saved formatter renamed');
  }

  function handleDeleteSavedFormatter(savedName: string) {
    setUserData((prev) => {
      const saved = { ...(prev.formatter.definitions?.saved ?? {}) };
      if (!saved[savedName]) return prev;
      delete saved[savedName];
      return {
        ...prev,
        formatter: {
          ...prev.formatter,
          definitions: {
            ...prev.formatter.definitions,
            saved: Object.keys(saved).length > 0 ? saved : undefined,
          },
        },
      };
    });
    toast.success('Saved formatter deleted');
  }

  return (
    <>
      <SettingsCard
        title="Formatter Selection"
        id="formatter"
        description="Choose how your streams should be formatted"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <Select
              value={currentId}
              onValueChange={handleIdChange}
              options={formatterChoices.map((f) => ({
                label: f.name,
                value: f.id,
              }))}
            />
          </div>
          {currentId !== constants.CUSTOM_FORMATTER && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 min-w-[7.75rem] text-center ${
                isCustomised
                  ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                  : 'bg-green-500/20 text-green-400 border-green-500/30'
              }`}
            >
              {isCustomised ? 'Customised' : 'Using built-in'}
            </span>
          )}
        </div>

        {currentId !== constants.CUSTOM_FORMATTER && (
          <p className="text-sm text-muted-foreground mt-2">
            {formatterChoices.find((f) => f.id === currentId)?.description}
          </p>
        )}

        {showTemplates && (
          <div className="space-y-4 mt-4">
            <div className="text-sm text-gray-400">
              Type <span className="font-mono">{'{debug.jsonf}'}</span> to see
              all available variables. See the{' '}
              <a
                href="https://docs.aiostreams.viren070.me/reference/custom-formatter"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:text-[--brand]/80 hover:underline"
              >
                docs
              </a>{' '}
              for a full reference.
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Name Template
              </label>
              <Textarea
                value={nameTemplate}
                onValueChange={(v) =>
                  setUserData((prev) =>
                    applyTemplates(prev, v, getTemplates(prev).description)
                  )
                }
                placeholder="Enter a template for the stream name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">
                Description Template
              </label>
              <Textarea
                value={descriptionTemplate}
                onValueChange={(v) =>
                  setUserData((prev) =>
                    applyTemplates(prev, getTemplates(prev).name, v)
                  )
                }
                placeholder="Enter a template for the stream description"
              />
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <SnippetsButton />
              {isCustomised && (
                <Button intent="white" size="sm" onClick={handleReset}>
                  Reset to built-in
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Tooltip
                  trigger={
                    <IconButton
                      rounded
                      size="sm"
                      intent="primary-subtle"
                      icon={<FaSave />}
                      onClick={savedModalDisclosure.open}
                    />
                  }
                >
                  Saved formatters
                </Tooltip>
                <Tooltip
                  trigger={
                    <IconButton
                      rounded
                      size="sm"
                      intent="primary-subtle"
                      icon={<FaFileImport />}
                      onClick={importModalDisclosure.open}
                    />
                  }
                >
                  Import
                </Tooltip>
                <Tooltip
                  trigger={
                    <IconButton
                      rounded
                      size="sm"
                      intent="primary-subtle"
                      icon={<FaFileExport />}
                      onClick={handleExport}
                    />
                  }
                >
                  Export
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      <ImportModal
        open={importModalDisclosure.isOpen}
        onOpenChange={importModalDisclosure.toggle}
        onImport={handleImport}
      />

      <SavedFormattersModal
        open={savedModalDisclosure.isOpen}
        onOpenChange={savedModalDisclosure.toggle}
        canSaveCurrent={
          currentId === constants.CUSTOM_FORMATTER || isCustomised
        }
        savedDefinitions={savedDefinitions}
        onSave={handleSaveCurrentFormatter}
        onLoad={handleLoadSavedFormatter}
        onRename={handleRenameSavedFormatter}
        onDelete={handleDeleteSavedFormatter}
      />
    </>
  );
}
