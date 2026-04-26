'use client';
import React, { useState } from 'react';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { verifyParentConfig } from '@/lib/api';
import { toast } from 'sonner';
import { GoLink, GoUnlink } from 'react-icons/go';
import type { ParentConfig } from '@aiostreams/core';

type MergeStrategy = 'inherit' | 'extend' | 'override';
type BinaryMergeStrategy = 'inherit' | 'override';

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
};

const SECTION_DESCRIPTIONS: Record<string, string> = {
  presets: 'Addon presets and groupings.',
  services:
    'Debrid and download service credentials. Use "Extend" to add or override individual services while keeping the rest from the parent.',
  filters: 'All include, exclude, require and prefer filters.',
  sorting: 'Sort criteria, deduplication rules and result limits.',
  formatter: 'Stream title formatter and applied templates.',
  proxy: 'Proxy configuration.',
  metadata: 'TMDB, RPDB, TVDB and poster API keys.',
  misc: 'Playback, display and other miscellaneous settings.',
};

export function ParentConfig() {
  const { userData, setUserData, uuid } = useUserData();

  const [uuidInput, setUuidInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [linking, setLinking] = useState(false);

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
          ...(prev.parentConfig?.mergeStrategies ?? {}),
          [section]: value,
        },
      },
    }));
  }

  const strategies = parentConfig?.mergeStrategies;

  return (
    <div className="space-y-4">
      {!parentConfig ? (
        <SettingsCard
          title="Link a Parent Config"
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
        </>
      )}
    </div>
  );
}
