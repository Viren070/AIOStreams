'use client';
import React, { useState } from 'react';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Select } from '../../../ui/select';
import { TextInput } from '../../../ui/text-input';
import { Combobox } from '../../../ui/combobox';
import { IconButton } from '../../../ui/button';
import { FaPlus, FaRegTrashAlt, FaArrowUp, FaArrowDown } from 'react-icons/fa';
import { arrayMove } from '@dnd-kit/sortable';

export function AddonFetchingBehaviorCard() {
  const { userData, setUserData } = useUserData();
  const [mode, setMode] = useState(() => {
    if (userData.dynamicAddonFetching?.enabled) return 'dynamic';
    if (userData.groups?.enabled) return 'groups';
    return 'default';
  });

  // Helper function to get presets that are not in any group except the current one
  const getAvailablePresets = (currentGroupIndex: number) => {
    const presetsInOtherGroups = new Set(
      userData.groups?.groupings?.flatMap((group, idx) =>
        idx !== currentGroupIndex ? group.addons : []
      ) || []
    );

    return userData.presets
      .filter((preset) => {
        return !presetsInOtherGroups.has(preset.instanceId);
      })
      .map((preset) => ({
        label: preset.options.name,
        value: preset.instanceId,
        textValue: preset.options.name,
      }));
  };

  const updateGroup = (
    index: number,
    updates: Partial<{ addons: string[]; condition: string }>
  ) => {
    setUserData((prev) => {
      const currentGroups = prev.groups?.groupings || [];
      const newGroups = [...currentGroups];
      newGroups[index] = {
        ...newGroups[index],
        ...updates,
      };
      if (index === 0) {
        newGroups[index].condition = 'true';
      }
      return {
        ...prev,
        groups: {
          ...prev.groups,
          groupings: newGroups,
        },
      };
    });
  };

  const handleModeChange = (newMode: string) => {
    setMode(newMode);
    setUserData((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        enabled: newMode === 'groups',
      },
      dynamicAddonFetching: {
        ...prev.dynamicAddonFetching,
        enabled: newMode === 'dynamic',
      },
    }));
  };

  const descriptions = {
    default:
      'Fetch from all addons simultaneously and wait for all addons to finish fetching before returning results.',
    groups:
      'Organise addons into groups with conditions. Each group can be evaluated based on results from previous groups. Read the [docs](https://docs.aiostreams.viren070.me/guides/groups) for more information.',
    dynamic:
      'All addons start fetching at the same time. As soon as any addon returns results, the exit condition is evaluated. If the condition is met, results are returned immediately and any remaining addon results are ignored.',
  };

  const placeholderExitConditions = [
    'count(resolution(totalStreams, "2160p")) > 0 or totalTimeTaken > 5000',
    "queryType == 'anime' ? (count(resolution(totalStreams, '1080p')) > 0 or totalTimeTaken > 5000) : false",
    "'addon' in queriedAddons and (totalTimeTaken >= 6000 or count(totalStreams) >= 5)",
    "count(seeders(size(totalStreams, '5GB', '20GB'), 50)) > 0",
    "queryType == 'movie' ? count(cached(resolution(totalStreams, '2160p'))) > 0 : count(resolution(totalStreams, '1080p')) >= 2",
    "count(cached(quality(totalStreams, 'Bluray REMUX', 'Bluray', 'WEB-DL'))) > 0",
  ];

  return (
    <SettingsCard
      title="Addon Fetching Strategy"
      id="fetchStrategy"
      description="Choose how streams are fetched from your addons"
    >
      <Select
        label="Strategy"
        value={mode}
        onValueChange={handleModeChange}
        options={[
          { label: 'Default', value: 'default' },
          { label: 'Dynamic', value: 'dynamic' },
          { label: 'Groups', value: 'groups' },
        ]}
      />

      <div className="text-sm text-[--muted] mt-2 mb-4">
        {descriptions[mode as keyof typeof descriptions]}
      </div>

      {mode === 'groups' && (
        <>
          <Select
            label="Group Behaviour"
            value={userData.groups?.behaviour ?? 'parallel'}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                groups: {
                  ...prev.groups,
                  behaviour: value as 'sequential' | 'parallel',
                },
              }));
            }}
            options={[
              { label: 'Parallel', value: 'parallel' },
              { label: 'Sequential', value: 'sequential' },
            ]}
            help={
              userData.groups?.behaviour === 'sequential'
                ? 'Sequential: Start with group 1. Only fetch from group 2 if its condition evaluates to true based on group 1\'s results (e.g., "count(totalStreams) < 4"). Continue this pattern for subsequent groups.'
                : "Parallel: Begin fetching from all groups simultaneously. When group 1's results arrive, evaluate group 2's condition. If true, wait for group 2's results; if false, return results without waiting."
            }
          />

          {(() => {
            const handleGroupsChange = (newGroups: any[]) => {
              const normalized = [...newGroups];
              if (normalized.length > 0) {
                normalized[0] = { ...normalized[0], condition: 'true' };
              }
              setUserData((prev) => ({
                ...prev,
                groups: { ...prev.groups, groupings: normalized },
              }));
            };

            return (userData.groups?.groupings || []).map((group, index) => (
              <div key={index} className="flex gap-2">
                <div className="flex-1 flex gap-2">
                  <div className="flex-1">
                    <Combobox
                      multiple
                      value={group.addons}
                      options={getAvailablePresets(index)}
                      emptyMessage="You haven't installed any addons yet or they are already in a group"
                      label="Addons"
                      placeholder="Select addons"
                      onValueChange={(value) => {
                        updateGroup(index, { addons: value });
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <TextInput
                      value={index === 0 ? 'true' : group.condition}
                      disabled={index === 0}
                      label="Condition"
                      placeholder="Enter condition"
                      onValueChange={(value) => {
                        updateGroup(index, { condition: value });
                      }}
                    />
                  </div>
                </div>
                <IconButton
                  size="sm"
                  rounded
                  icon={<FaArrowUp />}
                  intent="primary-subtle"
                  disabled={index === 0}
                  onClick={() => {
                    handleGroupsChange(
                      arrayMove(
                        userData.groups?.groupings || [],
                        index,
                        index - 1
                      )
                    );
                  }}
                />
                <IconButton
                  size="sm"
                  rounded
                  icon={<FaArrowDown />}
                  intent="primary-subtle"
                  disabled={
                    index === (userData.groups?.groupings || []).length - 1
                  }
                  onClick={() => {
                    handleGroupsChange(
                      arrayMove(
                        userData.groups?.groupings || [],
                        index,
                        index + 1
                      )
                    );
                  }}
                />
                <IconButton
                  size="sm"
                  rounded
                  icon={<FaRegTrashAlt />}
                  intent="alert-subtle"
                  onClick={() => {
                    const newGroups = [...(userData.groups?.groupings || [])];
                    newGroups.splice(index, 1);
                    handleGroupsChange(newGroups);
                  }}
                />
              </div>
            ));
          })()}

          <div className="mt-2 flex gap-2 items-center">
            <IconButton
              rounded
              size="sm"
              intent="primary-subtle"
              icon={<FaPlus />}
              onClick={() => {
                setUserData((prev) => {
                  const currentGroups = prev.groups?.groupings || [];
                  const newGroup = {
                    addons: [],
                    condition: currentGroups.length === 0 ? 'true' : '',
                  };
                  return {
                    ...prev,
                    groups: {
                      ...prev.groups,
                      groupings: [...currentGroups, newGroup],
                    },
                  };
                });
              }}
            />
          </div>
        </>
      )}

      {mode === 'dynamic' && (
        <TextInput
          label="Exit Condition"
          placeholder={
            placeholderExitConditions[
              Math.floor(Math.random() * placeholderExitConditions.length)
            ]
          }
          value={userData.dynamicAddonFetching?.condition ?? ''}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              dynamicAddonFetching: {
                ...prev.dynamicAddonFetching,
                condition: value,
              },
            }));
          }}
          help={
            <p>
              Write the condition using{' '}
              <a
                href="https://docs.aiostreams.viren070.me/reference/stream-expressions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                Stream Expression Language (SEL)
              </a>
              . The following variables are available:
              <ul className="list-disc list-inside space-y-1 ml-2 mt-2">
                <li>
                  <code>totalStreams</code>: The total number of streams
                </li>
                <li>
                  <code>totalTimeTaken</code>: The total time taken to fetch the
                  streams
                </li>
                <li>
                  <code>queryType</code>: The type of query e.g. 'movie',
                  'series', or 'anime'
                </li>
                <li>
                  <code>queriedAddons</code>: The addons that have been queried.
                  Tip: use the <code>in</code> operator to check if a specific
                  addon has been queried.
                </li>
                <li>
                  <code>allAddons</code>: All addons that were intended to be
                  used for that query.
                </li>
              </ul>
            </p>
          }
        />
      )}
    </SettingsCard>
  );
}
