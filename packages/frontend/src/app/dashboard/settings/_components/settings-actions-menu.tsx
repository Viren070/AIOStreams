import React from 'react';
import {
  BiDotsVerticalRounded,
  BiReset,
  BiImport,
  BiDownload,
  BiUpload,
} from 'react-icons/bi';
import { IconButton } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { SettingsKey } from '../queries';
import { ResetSettingsModal } from './reset-settings-modal';
import { ImportEnvModal } from './import-env-modal';
import { ImportSettingsModal } from './import-settings-modal';

/**
 * Page-level actions menu rendered next to the settings page header. Hosts
 * destructive / cross-cutting operations (reset, env import, export) so we
 * don't pollute every field/card with extra controls.
 */
export function SettingsActionsMenu({
  allKeys,
  sectionKeys,
  sectionLabel,
}: {
  allKeys: SettingsKey[];
  sectionKeys: SettingsKey[];
  sectionLabel: string;
}) {
  const [resetScope, setResetScope] = React.useState<'section' | 'all' | null>(
    null
  );
  const [importEnvOpen, setImportEnvOpen] = React.useState(false);
  const [importJsonOpen, setImportJsonOpen] = React.useState(false);

  // Counts drive the disabled state so the menu honestly reflects what the
  // user can do right now.
  const sectionResettable = React.useMemo(
    () => sectionKeys.filter((k) => k.source === 'database').length,
    [sectionKeys]
  );
  const allResettable = React.useMemo(
    () => allKeys.filter((k) => k.source === 'database').length,
    [allKeys]
  );
  const envCandidates = React.useMemo(
    () => allKeys.filter((k) => k.source === 'environment').length,
    [allKeys]
  );

  const downloadExport = () => {
    // Hits the same endpoint with `?download=1` so the server sets a
    // Content-Disposition header. `window.open` keeps cookies/credentials.
    window.open('/api/v1/dashboard/settings/export?download=1', '_blank');
  };

  return (
    <>
      <DropdownMenu
        align="end"
        trigger={
          <IconButton
            size="sm"
            intent="gray-subtle"
            icon={<BiDotsVerticalRounded />}
            aria-label="Settings actions"
          />
        }
      >
        <DropdownMenuLabel>Reset</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => setResetScope('section')}
          disabled={sectionResettable === 0}
        >
          <BiReset />
          Reset settings in this section…
          <span className="ml-auto text-xs text-[--muted]">
            {sectionResettable}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setResetScope('all')}
          disabled={allResettable === 0}
        >
          <BiReset />
          Reset all settings…
          <span className="ml-auto text-xs text-[--muted]">
            {allResettable}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Environment</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => setImportEnvOpen(true)}
          disabled={envCandidates === 0}
        >
          <BiImport />
          Import environment variables…
          <span className="ml-auto text-xs text-[--muted]">
            {envCandidates}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Backup</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setImportJsonOpen(true)}>
          <BiDownload />
          Import database settings…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={downloadExport}>
          <BiUpload />
          Export database settings
        </DropdownMenuItem>
      </DropdownMenu>

      <ResetSettingsModal
        open={resetScope !== null}
        onOpenChange={(o) => !o && setResetScope(null)}
        scope={resetScope ?? 'section'}
        scopeLabel={resetScope === 'all' ? 'all settings' : sectionLabel}
        keys={resetScope === 'all' ? allKeys : sectionKeys}
      />

      <ImportEnvModal
        open={importEnvOpen}
        onOpenChange={setImportEnvOpen}
        envKeys={allKeys.filter((k) => k.source === 'environment')}
      />

      <ImportSettingsModal
        open={importJsonOpen}
        onOpenChange={setImportJsonOpen}
      />
    </>
  );
}
