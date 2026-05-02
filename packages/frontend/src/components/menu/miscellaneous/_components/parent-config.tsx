'use client';
import React, { useState, useMemo } from 'react';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { verifyParentConfig } from '@/lib/api';
import { toast } from 'sonner';
import { GoLink, GoUnlink } from 'react-icons/go';
import { FiSettings } from 'react-icons/fi';
import type { ParentConfig, FieldGroup } from '@aiostreams/core';
import { FIELD_META } from '../../../../../../core/src/utils/fieldMeta';

type MergeStrategy = 'inherit' | 'extend' | 'override';
type BinaryMergeStrategy = 'inherit' | 'override';
type FieldOverrides = Record<string, MergeStrategy>;

const BINARY_OPTIONS = [
  { value: 'inherit', label: 'Inherit from parent' },
  { value: 'override', label: 'Override with mine' },
];

const TERNARY_OPTIONS = [
  { value: 'inherit', label: 'Inherit from parent' },
  { value: 'extend', label: 'Extend parent (add mine)' },
  { value: 'override', label: 'Override with mine' },
];

const SECTION_LABELS: Record<string, string> = {
  presets: 'Addons',
  services: 'Services',
  filters: 'Filters',
  sorting: 'Sorting & Deduplication',
  formatter: 'Formatter',
  proxy: 'Proxy',
  metadata: 'Metadata & Poster APIs',
  misc: 'Miscellaneous Settings',
  branding: 'Branding',
};

const SECTION_DESCRIPTIONS: Record<string, string> = {
  presets: 'Addon presets and groupings.',
  services:
    'Debrid and download service credentials. Use "Extend" to add or override individual services while keeping the rest from the parent.',
  filters: 'All include, exclude, require and prefer filters.',
  sorting: 'Sort criteria, deduplication rules and result limits.',
  formatter: 'Stream title formatter.',
  proxy: 'Proxy configuration.',
  metadata: 'TMDB, RPDB, TVDB and poster API keys.',
  misc: 'Playback, display and other miscellaneous settings.',
  branding: 'Addon visual identity overrides.',
};

const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  filters: 'Filters',
  sorting: 'Sorting',
  formatter: 'Formatter',
  proxy: 'Proxy',
  metadata: 'Metadata',
  misc: 'Misc',
  branding: 'Branding',
};

const FIELD_GROUPS: FieldGroup[] = [
  'filters',
  'sorting',
  'formatter',
  'proxy',
  'metadata',
  'misc',
  'branding',
];

// All inheritable field keys, pre-sorted by label within their group.
// Fields with ignoreForParentConfig are command-palette-only and cannot be
// individually overridden here.
const ALL_FIELD_KEYS = Object.entries(FIELD_META)
  .filter(([, meta]) => !meta.ignoreForParentConfig)
  .map(([key]) => key as keyof typeof FIELD_META)
  .sort((a, b) =>
    (FIELD_META[a]?.label ?? a).localeCompare(FIELD_META[b]?.label ?? b)
  );

const FIELDS_BY_GROUP = Object.fromEntries(
  FIELD_GROUPS.map((group) => [
    group,
    ALL_FIELD_KEYS.filter((k) => FIELD_META[k]?.group === group),
  ])
) as Record<FieldGroup, (keyof typeof FIELD_META)[]>;

function getGroupStrategyForField(
  field: keyof typeof FIELD_META,
  strategies: ParentConfig['mergeStrategies']
): MergeStrategy {
  const group = FIELD_META[field]?.group;
  if (!group) return 'inherit';
  return (
    (strategies?.[group as keyof typeof strategies] as MergeStrategy) ??
    'inherit'
  );
}

function FieldRow({
  field,
  meta,
  activeOverride,
  groupStrategy,
  trimmedSearch,
  onChange,
}: {
  field: string;
  meta: any;
  activeOverride?: string;
  groupStrategy: string;
  trimmedSearch?: boolean;
  onChange: (field: string, value: string) => void;
}) {
  const isList = meta.type === 'list';
  const fieldOptions = isList ? TERNARY_OPTIONS : BINARY_OPTIONS;
  const placeholderLabel =
    groupStrategy === 'inherit'
      ? 'Inherit (group)'
      : groupStrategy === 'override'
        ? 'Override (group)'
        : 'Extend (group)';

  const optionsWithDefault = [
    { value: 'default', label: `Default: ${placeholderLabel}` },
    ...fieldOptions,
  ];

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-[--radius] hover:bg-[--subtle] group">
      {/* Label + group badge when searching */}
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-2">
        <span className="text-sm font-medium">{meta.label}</span>
        {trimmedSearch && (
          <span className="text-xs text-[--muted]">
            ({FIELD_GROUP_LABELS[meta.group as FieldGroup]})
          </span>
        )}
      </div>

      {/* Strategy selector */}
      <div className="w-48 shrink-0">
        <Select
          size="sm"
          options={optionsWithDefault}
          value={activeOverride ?? 'default'}
          onValueChange={(v) => onChange(field, v)}
        />
      </div>
    </div>
  );
}

interface FieldOverridesModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  strategies: ParentConfig['mergeStrategies'];
  fieldOverrides: FieldOverrides;
  onChange: (
    overrides: FieldOverrides | ((prev: FieldOverrides) => FieldOverrides)
  ) => void;
}

function FieldOverridesModal({
  open,
  onOpenChange,
  strategies,
  fieldOverrides,
  onChange,
}: FieldOverridesModalProps) {
  const [activeGroup, setActiveGroup] = useState<FieldGroup>('filters');
  const [search, setSearch] = useState('');

  const trimmedSearch = search.trim().toLowerCase();

  const visibleFields = useMemo(() => {
    if (trimmedSearch) {
      return ALL_FIELD_KEYS.filter((k) =>
        (FIELD_META[k]?.label ?? k).toLowerCase().includes(trimmedSearch)
      );
    }
    return FIELDS_BY_GROUP[activeGroup] ?? [];
  }, [trimmedSearch, activeGroup]);

  function handleFieldChange(field: keyof typeof FIELD_META, value: string) {
    onChange((prev) => {
      const next = { ...prev };
      if (!value || value === 'default') {
        delete next[field as string];
      } else {
        next[field as string] = value as MergeStrategy;
      }
      return next;
    });
  }

  function clearGroupOverrides(group: FieldGroup) {
    const fieldsInGroup = new Set(
      ALL_FIELD_KEYS.filter((k) => FIELD_META[k]?.group === group).map(
        (k) => k as string
      )
    );
    onChange((prev) => {
      return Object.fromEntries(
        Object.entries(prev).filter(([k]) => !fieldsInGroup.has(k))
      );
    });
  }

  const overrideCountByGroup = useMemo(
    () =>
      Object.fromEntries(
        FIELD_GROUPS.map((g) => [
          g,
          ALL_FIELD_KEYS.filter(
            (k) => FIELD_META[k]?.group === g && fieldOverrides[k as string]
          ).length,
        ])
      ) as Record<FieldGroup, number>,
    [fieldOverrides]
  );

  const totalOverrides = Object.keys(fieldOverrides).filter(
    (k) => FIELD_META[k as keyof typeof FIELD_META]
  ).length;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Field Overrides"
      description="Override the merge strategy for individual config fields. Field overrides always take precedence over the section-level strategy above."
      contentClass="!max-w-3xl"
    >
      <div className="flex flex-col gap-4">
        {/* Search */}
        <TextInput
          placeholder="Search fields…"
          value={search}
          onValueChange={setSearch}
        />

        {!trimmedSearch && (
          /* Section tabs */
          <div className="flex gap-1.5 flex-wrap">
            {FIELD_GROUPS.map((group) => {
              const count = overrideCountByGroup[group];
              const isActive = activeGroup === group;
              return (
                <button
                  key={group}
                  onClick={() => setActiveGroup(group)}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-[--radius] text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-500 text-white'
                      : 'bg-[--subtle] text-[--muted] hover:text-[--text-color] hover:bg-[--subtle-border]',
                  ].join(' ')}
                >
                  {FIELD_GROUP_LABELS[group]}
                  {count > 0 && (
                    <span
                      className={[
                        'text-xs px-1.5 py-0.5 rounded-full font-semibold leading-none',
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-[--brand]/20 text-[--brand]',
                      ].join(' ')}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Header row: section label + clear button */}
        {!trimmedSearch && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[--text-color]">
              {FIELD_GROUP_LABELS[activeGroup]}
              <span className="ml-2 text-xs font-normal text-[--muted]">
                {FIELDS_BY_GROUP[activeGroup]?.length ?? 0} fields
              </span>
            </p>
            {overrideCountByGroup[activeGroup] > 0 && (
              <button
                onClick={() => clearGroupOverrides(activeGroup)}
                className="text-xs text-[--muted] hover:text-[--text-color] transition-colors"
              >
                Clear {overrideCountByGroup[activeGroup]} override
                {overrideCountByGroup[activeGroup] !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}

        {trimmedSearch && (
          <p className="text-sm text-[--muted]">
            {visibleFields.length} field{visibleFields.length !== 1 ? 's' : ''}{' '}
            matching &ldquo;{search.trim()}&rdquo;
          </p>
        )}

        {/* Field list */}
        <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-0.5">
          {visibleFields.length === 0 ? (
            <p className="text-sm text-[--muted] py-4 text-center">
              No fields found.
            </p>
          ) : (
            visibleFields.map((field) => {
              const meta = FIELD_META[field]!;
              const activeOverride = fieldOverrides[field as string] as
                | MergeStrategy
                | undefined;
              const groupStrategy = getGroupStrategyForField(field, strategies);

              return (
                <FieldRow
                  key={field as string}
                  field={field as string}
                  meta={meta}
                  activeOverride={activeOverride}
                  groupStrategy={groupStrategy}
                  trimmedSearch={!!trimmedSearch}
                  onChange={(f, v) =>
                    handleFieldChange(f as keyof typeof FIELD_META, v)
                  }
                />
              );
            })
          )}
        </div>

        {/* Footer summary */}
        {totalOverrides > 0 && (
          <p className="text-xs text-[--muted] border-t pt-3">
            {totalOverrides} field override{totalOverrides !== 1 ? 's' : ''}{' '}
            active across all sections.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function ParentConfig() {
  const { userData, setUserData, uuid } = useUserData();

  const [uuidInput, setUuidInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [linking, setLinking] = useState(false);
  const [overridesOpen, setOverridesOpen] = useState(false);

  const parentConfig = userData.parentConfig;

  async function handleLink(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (!uuidInput.trim() || !passwordInput) return;
    setLinking(true);
    if (uuidInput === uuid) {
      toast.error('You cannot link to your own config');
      setLinking(false);
      return;
    }
    try {
      const info = await verifyParentConfig(uuidInput.trim(), passwordInput);
      setUserData((prev) => ({
        ...prev,
        parentConfig: {
          uuid: info.uuid,
          password: passwordInput,
          mergeStrategies: {
            presets: 'inherit',
            services: 'inherit',
            filters: 'inherit',
            sorting: 'inherit',
            formatter: 'inherit',
            proxy: 'inherit',
            metadata: 'inherit',
            misc: 'inherit',
            branding: 'inherit',
          },
        },
      }));
      setUuidInput('');
      setPasswordInput('');
      toast.success('Parent config linked. Save your config to apply.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to link parent config');
    } finally {
      setLinking(false);
    }
  }

  function handleUnlink() {
    setUserData((prev) => {
      const next = { ...prev };
      delete next.parentConfig;
      return next;
    });
    toast.success('Parent config removed. Save your config to apply.');
  }

  function setStrategy(
    section: keyof NonNullable<ParentConfig['mergeStrategies']>,
    value: string
  ) {
    setUserData((prev) => ({
      ...prev,
      parentConfig: {
        ...prev.parentConfig!,
        mergeStrategies: {
          presets: 'inherit',
          services: 'inherit',
          filters: 'inherit',
          sorting: 'inherit',
          formatter: 'inherit',
          proxy: 'inherit',
          metadata: 'inherit',
          misc: 'inherit',
          branding: 'inherit',
          ...(prev.parentConfig?.mergeStrategies ?? {}),
          [section]: value,
        },
      },
    }));
  }

  function handleFieldOverridesChange(
    updater: FieldOverrides | ((prev: FieldOverrides) => FieldOverrides)
  ) {
    setUserData((prev) => {
      const parentStrat = prev.parentConfig?.mergeStrategies ?? {};
      const prevOverrides = ((parentStrat as any).fieldOverrides ??
        {}) as FieldOverrides;
      const nextOverrides =
        typeof updater === 'function' ? updater(prevOverrides) : updater;

      return {
        ...prev,
        parentConfig: {
          ...prev.parentConfig!,
          mergeStrategies: {
            presets: 'inherit',
            services: 'inherit',
            filters: 'inherit',
            sorting: 'inherit',
            formatter: 'inherit',
            proxy: 'inherit',
            metadata: 'inherit',
            misc: 'inherit',
            branding: 'inherit',
            ...parentStrat,
            fieldOverrides:
              Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
          },
        },
      };
    });
  }

  const strategies = parentConfig?.mergeStrategies;
  const fieldOverrides = (strategies?.fieldOverrides ?? {}) as FieldOverrides;
  const activeOverrideCount = Object.keys(fieldOverrides).filter(
    (k) => FIELD_META[k as keyof typeof FIELD_META]
  ).length;

  return (
    <div className="space-y-4">
      {!parentConfig ? (
        <SettingsCard
          title="Link a Parent Config"
          id="parentConfig"
          description="Inherit settings from another config at runtime. Any changes made to the parent are immediately reflected here."
        >
          <form onSubmit={handleLink} className="space-y-3">
            <TextInput
              label="Parent UUID"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={uuidInput}
              onValueChange={setUuidInput}
            />
            <PasswordInput
              label="Parent Password"
              value={passwordInput}
              onValueChange={setPasswordInput}
            />
            <Button
              type="submit"
              size="sm"
              intent="white"
              rounded
              loading={linking}
              disabled={!uuidInput.trim() || !passwordInput}
              leftIcon={<GoLink />}
            >
              Link Parent
            </Button>
          </form>
        </SettingsCard>
      ) : (
        <>
          <SettingsCard
            title="Parent Config"
            id="parentConfig"
            description="Settings from the parent config are merged into this config at runtime."
            action={
              <Button
                intent="alert-subtle"
                size="sm"
                leftIcon={<GoUnlink />}
                onClick={handleUnlink}
              >
                Unlink
              </Button>
            }
          >
            <div className="flex items-center gap-2 p-2 rounded-[--radius] bg-[--subtle] border text-sm">
              <GoLink className="shrink-0 text-[--muted]" />
              <span className="font-mono text-xs truncate text-[--muted]">
                {parentConfig.uuid}
              </span>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Merge Strategies"
            description="For each section, choose whether to use the parent's settings, combine them with yours, or use only yours."
          >
            <div className="space-y-4">
              {(['presets', 'services'] as const).map((section) => (
                <div key={section} className="space-y-1">
                  <Select
                    label={SECTION_LABELS[section]}
                    help={SECTION_DESCRIPTIONS[section]}
                    options={TERNARY_OPTIONS}
                    value={strategies?.[section] ?? 'inherit'}
                    onValueChange={(v) =>
                      setStrategy(section, v as MergeStrategy)
                    }
                  />
                </div>
              ))}
              {(
                [
                  'filters',
                  'sorting',
                  'formatter',
                  'proxy',
                  'metadata',
                  'misc',
                  'branding',
                ] as const
              ).map((section) => (
                <div key={section} className="space-y-1">
                  <Select
                    label={SECTION_LABELS[section]}
                    help={SECTION_DESCRIPTIONS[section]}
                    options={BINARY_OPTIONS}
                    value={strategies?.[section] ?? 'inherit'}
                    onValueChange={(v) =>
                      setStrategy(section, v as BinaryMergeStrategy)
                    }
                  />
                </div>
              ))}
            </div>
          </SettingsCard>

          <SettingsCard
            title="Field Overrides"
            description="Fine-tune inheritance by setting a different strategy for individual fields. Overrides always take precedence over the section strategies above."
            action={
              <IconButton
                size="sm"
                intent="white"
                rounded
                icon={<FiSettings />}
                onClick={() => setOverridesOpen(true)}
                title="Configure Field Overrides"
              />
            }
          >
            {activeOverrideCount > 0 ? (
              <div className="space-y-1 mt-2">
                {Object.keys(fieldOverrides)
                  .filter((k) => FIELD_META[k as keyof typeof FIELD_META])
                  .map((fieldStr) => {
                    const field = fieldStr as keyof typeof FIELD_META;
                    const meta = FIELD_META[field]!;
                    const activeOverride = fieldOverrides[field] as
                      | MergeStrategy
                      | undefined;
                    const groupStrategy = getGroupStrategyForField(
                      field,
                      strategies
                    );
                    return (
                      <FieldRow
                        key={field}
                        field={field}
                        meta={meta}
                        activeOverride={activeOverride}
                        groupStrategy={groupStrategy}
                        trimmedSearch={false}
                        onChange={(f, v) => {
                          handleFieldOverridesChange((prevOverrides) => {
                            const next = { ...prevOverrides };
                            if (!v || v === 'default') {
                              delete next[f];
                            } else {
                              next[f] = v as MergeStrategy;
                            }
                            return next;
                          });
                        }}
                      />
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-[--muted] pt-2">
                No field overrides configured. All fields use their section
                strategy.
              </p>
            )}
          </SettingsCard>

          <FieldOverridesModal
            open={overridesOpen}
            onOpenChange={setOverridesOpen}
            strategies={strategies}
            fieldOverrides={fieldOverrides}
            onChange={handleFieldOverridesChange}
          />
        </>
      )}
    </div>
  );
}
