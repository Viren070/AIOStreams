import React, { useCallback, useState } from 'react';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import {
  ItemActions,
  SortableList,
  SortableRow,
  rowActionsClass,
  useSortableRows,
} from '../../../shared/sortable-rows';
import { Select } from '../../../ui/select';
import { TextInput } from '../../../ui/text-input';
import { Combobox } from '../../../ui/combobox';
import { IconButton } from '../../../ui/button';
import { Tooltip } from '../../../ui/tooltip';
import { FaPlus } from 'react-icons/fa';
import { UserData } from '@aiostreams/core';

type Grouping = NonNullable<
  NonNullable<UserData['groups']>['groupings']
>[number];

/** Group 1 has nothing before it to test, so its condition is never read. */
const FIRST_GROUP_CONDITION = 'true';

function GroupList() {
  const { userData, setUserData } = useUserData();
  const groupings = userData.groups?.groupings ?? [];

  const setGroupings = useCallback(
    (newGroups: Grouping[]) => {
      const normalized = [...newGroups];
      if (normalized.length > 0 && !normalized[0].condition) {
        normalized[0] = { ...normalized[0], condition: FIRST_GROUP_CONDITION };
      }
      setUserData((prev) => ({
        ...prev,
        groups: { ...prev.groups, groupings: normalized },
      }));
    },
    [setUserData]
  );

  const rows = useSortableRows(groupings, setGroupings);

  const updateGroup = (index: number, updates: Partial<Grouping>) => {
    setGroupings(
      groupings.map((group, i) =>
        i === index ? { ...group, ...updates } : group
      )
    );
  };

  // An addon belongs to at most one group, so only the ones this group already
  // holds and the ones no group has claimed are offered.
  const getAvailablePresets = (currentGroupIndex: number) => {
    const presetsInOtherGroups = new Set(
      groupings.flatMap((group, idx) =>
        idx !== currentGroupIndex ? group.addons : []
      )
    );

    return userData.presets
      .filter((preset) => !presetsInOtherGroups.has(preset.instanceId))
      .map((preset) => ({
        label: preset.options.name,
        value: preset.instanceId,
        textValue: preset.options.name,
      }));
  };

  return (
    <>
      <div className="text-sm text-[--muted] mb-2">
        Each row is one group: the addons it fetches from, and the condition
        deciding whether it is used. Group 1 always runs, so its condition is
        fixed.
      </div>
      <SortableList rows={rows}>
        {groupings.map((group, index) => {
          const key = rows.keyAt(index);
          return (
            <SortableRow key={key} id={key}>
              <div className={rowActionsClass}>
                <ItemActions rows={rows} index={index} />
              </div>
              <div className="md:flex-[2] min-w-0">
                <Combobox
                  multiple
                  maxDisplayedItems={3}
                  value={group.addons}
                  options={getAvailablePresets(index)}
                  emptyMessage="You haven't installed any addons yet or they are already in a group"
                  aria-label="Addons"
                  placeholder="Select addons"
                  onValueChange={(value) => {
                    updateGroup(index, { addons: value });
                  }}
                />
              </div>
              <div className="md:flex-[3] min-w-0">
                <TextInput
                  // Group 1 reads as `true` whatever it stores, so a condition
                  // carried up from a lower position survives being moved back.
                  value={index === 0 ? FIRST_GROUP_CONDITION : group.condition}
                  disabled={index === 0}
                  aria-label="Condition"
                  placeholder="count(totalStreams) < 4"
                  onValueChange={(value) => {
                    updateGroup(index, { condition: value });
                  }}
                />
              </div>
            </SortableRow>
          );
        })}
      </SortableList>

      <div className="mt-2 flex gap-2 items-center">
        <Tooltip
          trigger={
            <IconButton
              rounded
              size="sm"
              intent="primary-subtle"
              icon={<FaPlus />}
              aria-label="Add group"
              onClick={() =>
                setGroupings([
                  ...groupings,
                  {
                    addons: [],
                    condition:
                      groupings.length === 0 ? FIRST_GROUP_CONDITION : '',
                  },
                ])
              }
            />
          }
        >
          Add group
        </Tooltip>
      </div>
    </>
  );
}

export function AddonFetchingBehaviorCard() {
  const { userData, setUserData } = useUserData();
  const [mode, setMode] = useState(() => {
    if (userData.dynamicAddonFetching?.enabled) return 'dynamic';
    if (userData.groups?.enabled) return 'groups';
    return 'default';
  });

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

  const conditionFailureDescriptions = {
    stop: 'Discard this group and every group after it, including any results they had already returned.',
    skip: "Discard this group, then carry on checking the remaining groups' conditions as normal. A later group is included only if its condition passes and it has already finished. Nothing is waited on.",
    includeFinished:
      'Include this group and every group after it that has already finished, ignoring their conditions. Nothing is waited on.',
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

          {userData.groups?.behaviour !== 'sequential' && (
            <Select
              label="When a Condition Fails"
              value={userData.groups?.onConditionFailure ?? 'stop'}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  groups: {
                    ...prev.groups,
                    onConditionFailure: value as
                      | 'stop'
                      | 'skip'
                      | 'includeFinished',
                  },
                }));
              }}
              options={[
                { label: 'Stop', value: 'stop' },
                { label: 'Skip group and keep checking', value: 'skip' },
                {
                  label: 'Keep everything already finished',
                  value: 'includeFinished',
                },
              ]}
              help={
                conditionFailureDescriptions[
                  userData.groups?.onConditionFailure ?? 'stop'
                ]
              }
            />
          )}

          <GroupList />
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
