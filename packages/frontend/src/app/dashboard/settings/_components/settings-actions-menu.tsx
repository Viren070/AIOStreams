import React from 'react';
import { toast } from 'sonner';
import type { QueryKey } from '@tanstack/react-query';
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
import { fetchSettingsExport, type SettingsKey } from '../queries';
import { ResetSettingsModal } from './reset-settings-modal';
import { ImportEnvModal } from './import-env-modal';
import { ImportSettingsModal } from './import-settings-modal';

/**
 * Narrows the menu to a subset of the config (e.g. the usenet engine keys).
 * When present, reset/import/export only touch keys matched by `includes`, and
 * export is built client-side so nothing outside the scope can leak.
 */
export interface SettingsActionsScope {
  /** Whether a dotted key belongs to this menu's scope. */
  includes: (key: string) => boolean;
  /** Filename stem for exports, e.g. `aiostreams-usenet-settings`. */
  fileStem: string;
  /** Noun for the backup menu labels, e.g. `usenet` → "Export usenet settings". */
  noun: string;
}

/**
 * Page-level actions menu rendered next to the settings page header. Hosts
 * destructive / cross-cutting operations (reset, env import, export) so we
 * don't pollute every field/card with extra controls.
 */
export function SettingsActionsMenu({
  allKeys,
  sectionKeys,
  sectionLabel,
  invalidate,
  scope,
}: {
  /** Full key set for the "Reset all settings" item. Omit to hide it. */
  allKeys?: SettingsKey[];
  /** Keys in scope for this menu (drives the section reset + counts). */
  sectionKeys: SettingsKey[];
  sectionLabel: string;
  /** Query keys to refetch after reset/import (defaults to the whole
   *  dashboard scope). */
  invalidate?: QueryKey[];
  scope?: SettingsActionsScope;
}) {
  const [resetScope, setResetScope] = React.useState<'section' | 'all' | null>(
    null
  );
  const [importEnvOpen, setImportEnvOpen] = React.useState(false);
  const [importJsonOpen, setImportJsonOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // Counts drive the disabled state so the menu honestly reflects what the
  // user can do right now.
  const sectionResettable = React.useMemo(
    () => sectionKeys.filter((k) => k.source === 'database').length,
    [sectionKeys]
  );
  const allResettable = React.useMemo(
    () => (allKeys ?? []).filter((k) => k.source === 'database').length,
    [allKeys]
  );
  const envCandidates = React.useMemo(
    () => (allKeys ?? []).filter((k) => k.source === 'environment').length,
    [allKeys]
  );

  const downloadExport = async () => {
    if (!scope) {
      // Global export: hit the endpoint with `?download=1` so the server sets a
      // Content-Disposition header. `window.open` keeps cookies/credentials.
      window.open('/api/v1/dashboard/settings/export?download=1', '_blank');
      return;
    }
    // Scoped export: fetch the (already secret-masked) payload and keep only the
    // in-scope keys, then trigger a client-side download.
    setExporting(true);
    try {
      const payload = await fetchSettingsExport();
      const settings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload.settings)) {
        if (scope.includes(k)) settings[k] = v;
      }
      const scoped = {
        ...payload,
        settings,
        maskedSecretKeys: payload.maskedSecretKeys.filter((k) =>
          scope.includes(k)
        ),
      };
      const blob = new Blob([JSON.stringify(scoped, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${scope.fileStem}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to export settings');
    } finally {
      setExporting(false);
    }
  };

  const backupNoun = scope ? scope.noun : 'database';

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
        {allKeys && (
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
        )}
        {!scope && (
          <>
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
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Backup</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setImportJsonOpen(true)}>
          <BiDownload />
          Import {backupNoun} settings…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={downloadExport} disabled={exporting}>
          <BiUpload />
          Export {backupNoun} settings
        </DropdownMenuItem>
      </DropdownMenu>

      <ResetSettingsModal
        open={resetScope !== null}
        onOpenChange={(o) => !o && setResetScope(null)}
        scope={resetScope ?? 'section'}
        scopeLabel={resetScope === 'all' ? 'all settings' : sectionLabel}
        keys={resetScope === 'all' && allKeys ? allKeys : sectionKeys}
        invalidate={invalidate}
      />

      {!scope && (
        <ImportEnvModal
          open={importEnvOpen}
          onOpenChange={setImportEnvOpen}
          envKeys={(allKeys ?? []).filter((k) => k.source === 'environment')}
        />
      )}

      <ImportSettingsModal
        open={importJsonOpen}
        onOpenChange={setImportJsonOpen}
        restrict={scope?.includes}
        invalidate={invalidate}
      />
    </>
  );
}
