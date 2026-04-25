'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { applyMigrations, useUserData } from '@/context/userData';
import {
  createUserConfig,
  deleteUserConfig,
  changePassword,
  CreateUserResponse,
  APIError,
} from '@/lib/api';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Alert } from '@/components/ui/alert';
import { SettingsCard } from '../shared/settings-card';
import { toast } from 'sonner';
import {
  CopyIcon,
  DownloadIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from 'lucide-react';
import { LuSquareCheck, LuSquareMinus, LuWand } from 'react-icons/lu';
import { AnimatePresence, motion } from 'motion/react';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/button';
import { useStatus } from '@/context/status';
import { BiCopy } from 'react-icons/bi';
import { copyToClipboard } from '@/utils/clipboard';
import { PageControls } from '../shared/page-controls';
import { useDisclosure } from '@/hooks/disclosure';
import { Modal } from '../ui/modal';
import { Switch } from '../ui/switch';
import { TemplateExportModal } from '../shared/templates/export-modal';
import { ConfigTemplatesModal } from '../shared/templates';
import { PasswordInput } from '../ui/password-input';
import { useMenu } from '@/context/menu';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../shared/confirmation-dialog';
import { UserData } from '@aiostreams/core';
import { useSave } from '@/context/save';
import { AddonPasswordModal } from '@/components/shared/addon-password-modal';
import { FiExternalLink } from 'react-icons/fi';

// Reusable modal option button component
interface ModalOptionButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}

function ModalOptionButton({
  onClick,
  icon,
  title,
  description,
}: ModalOptionButtonProps) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-gray-700 bg-gradient-to-br from-gray-800/50 to-gray-800/30 p-6 text-center transition-all hover:border-brand-400 hover:from-brand-400/10 hover:to-brand-400/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-400"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-lg transition-transform group-hover:scale-110">
        {icon}
      </div>
      <div>
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          {description}
        </p>
      </div>
    </button>
  );
}

interface AppCardProps {
  logoSrc: string;
  name: string;
  description: string;
  onClick: () => void;
  unofficial?: boolean;
  beta?: boolean;
  author?: string;
  disabled?: boolean;
  disabledReason?: string;
}

function AppCard({
  logoSrc,
  name,
  description,
  onClick,
  unofficial,
  beta,
  author,
  disabled,
  disabledReason,
}: AppCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex items-center gap-3 rounded-xl border-2 border-gray-700 bg-gradient-to-br from-gray-800/50 to-gray-800/30 p-3 text-left transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-400 ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-brand-400 hover:from-brand-400/10 hover:to-brand-400/5'
      }`}
    >
      <div className="flex-shrink-0 h-8 w-8 rounded-lg overflow-hidden flex items-center justify-center">
        <img
          src={logoSrc}
          alt={name}
          className="h-full w-full object-contain"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-white">{name}</span>
          {beta && (
            <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
              Beta
            </span>
          )}
          {unofficial && (
            <span className="rounded-full border border-gray-600 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-300">
              Unofficial
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        {author && (
          <p className="text-[11px] text-gray-500 mt-0.5">
            Integration author: {author}
          </p>
        )}
        {disabledReason && (
          <p className="text-[11px] text-amber-300 mt-1">{disabledReason}</p>
        )}
      </div>
    </button>
  );
}

interface CreateConfigCardProps {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  passwordRequirements: string[];
  newPassword: string;
  confirmNewPassword: string;
  onNewPasswordChange: (value: string) => void;
  onConfirmNewPasswordChange: (value: string) => void;
  createLoading: boolean;
}

function CreateConfigCard({
  onSubmit,
  passwordRequirements,
  newPassword,
  confirmNewPassword,
  onNewPasswordChange,
  onConfirmNewPasswordChange,
  createLoading,
}: CreateConfigCardProps) {
  return (
    <SettingsCard
      title="Create Configuration"
      description="Set up your personalised addon configuration"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          {passwordRequirements.length > 0 && newPassword?.length > 0 && (
            <Alert
              intent="alert"
              title="Password Requirements"
              description={
                <ul className="list-disc list-inside">
                  {passwordRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              }
            />
          )}
          <PasswordInput
            label="Password"
            id="password"
            value={newPassword}
            onValueChange={onNewPasswordChange}
            placeholder="Enter a password to protect your configuration"
            required
            autoComplete="new-password"
          />
          <div className="pt-2">
            <PasswordInput
              label="Confirm Password"
              id="confirm-password"
              value={confirmNewPassword}
              onValueChange={onConfirmNewPasswordChange}
              placeholder="Re-enter your password"
              required
              autoComplete="new-password"
            />
          </div>
          <p className="text-sm text-[--muted] mt-1">
            This is the password you will use to access and update your
            configuration later. You can change your password later using the
            Change Password option, but please remember your current password as
            it is required to make changes.
          </p>
        </div>
        <Button intent="white" type="submit" loading={createLoading} rounded>
          Create
        </Button>
      </form>
    </SettingsCard>
  );
}

interface SaveConfigCardProps {
  uuid: string;
  onCopyUuid: () => void;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
  saveLoading: boolean;
  showChanges: boolean;
  onShowChangesChange: (value: boolean) => void;
}

function SaveConfigCard({
  uuid,
  onCopyUuid,
  onSave,
  saveLoading,
  showChanges,
  onShowChangesChange,
}: SaveConfigCardProps) {
  return (
    <SettingsCard
      title="Save Configuration"
      description="Save your configuration to your account by clicking Save below."
    >
      <div className="flex items-start gap-1">
        <Alert
          intent="info"
          isClosable={false}
          description={
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-md text-[--primary]">
                  Your UUID: <span className="font-bold">{uuid}</span>
                </span>
                <BiCopy
                  className="min-h-5 min-w-5 cursor-pointer"
                  onClick={onCopyUuid}
                />
              </div>
              <p className="text-sm text-[--muted]">
                Save your UUID and password - you'll need them to update your
                configuration later
              </p>
            </div>
          }
          className="flex-1"
        />
      </div>
      <form onSubmit={onSave}>
        <div className="flex items-center justify-between gap-4 mt-4">
          <Button type="submit" intent="white" loading={saveLoading} rounded>
            Save
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              id="show-changes"
              label="Show changes before saving"
              value={showChanges}
              onValueChange={onShowChangesChange}
            />
          </div>
        </div>
      </form>
    </SettingsCard>
  );
}

interface InstallCardProps {
  baseUrl: string;
  uuid: string;
  encryptedPassword: string;
  encodedManifest: string;
  manifestUrl: string;
  onCopyManifestUrl: () => void;
  onOpenChillio: () => void;
  onOpenSeanime: () => void;
  onOpenJellyfin: () => void;
  onOpenAniyomi: () => void;
  disableSeanimeCard?: boolean;
  seanimeDisabledReason?: string;
}

function InstallCard({
  baseUrl,
  uuid,
  encryptedPassword,
  encodedManifest,
  manifestUrl,
  onCopyManifestUrl,
  onOpenChillio,
  onOpenSeanime,
  onOpenJellyfin,
  onOpenAniyomi,
  disableSeanimeCard,
  seanimeDisabledReason,
}: InstallCardProps) {
  const stremioCardRef = React.useRef<HTMLDivElement>(null);
  const [stremioCardHeight, setStremioCardHeight] = React.useState<
    number | null
  >(null);
  const [isDesktop, setIsDesktop] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const updateViewport = () => setIsDesktop(mediaQuery.matches);
    updateViewport();

    mediaQuery.addEventListener('change', updateViewport);

    return () => {
      mediaQuery.removeEventListener('change', updateViewport);
    };
  }, []);

  React.useEffect(() => {
    if (!isDesktop) {
      setStremioCardHeight(null);
      return;
    }

    const element = stremioCardRef.current;
    if (!element) return;

    const updateHeight = () => {
      setStremioCardHeight(element.getBoundingClientRect().height);
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(element);

    window.addEventListener('resize', updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [isDesktop]);

  return (
    <SettingsCard
      title="Installation Options"
      description="Install your addon using your preferred method. If a reinstall is necessary, a pop-up will tell you — otherwise, you do not need to reinstall."
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:items-start">
        <div
          ref={stremioCardRef}
          className="lg:col-span-7 xl:col-span-8 flex flex-col gap-5 rounded-xl border border-gray-700 bg-gray-800/30 p-5 shadow-inner"
        >
          <div className="flex items-center gap-4 border-b border-gray-700/50 pb-4">
            <div className="flex-shrink-0 h-12 w-12 rounded-lg bg-gray-900 flex items-center justify-center p-2 shadow-sm">
              <img
                src="https://raw.githubusercontent.com/Stremio/stremio-brand/refs/heads/master/logos/PNG/stremio-logo-800px.png"
                alt="Stremio"
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Stremio</h3>
              <p className="text-sm text-gray-400">
                Install to Stremio or other Stremio addon compatible clients
                using the Manifest URL.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              onClick={() =>
                window.open(
                  `stremio://${baseUrl.replace(/^https?:\/\//, '')}/stremio/${uuid}/${encryptedPassword}/manifest.json`
                )
              }
              intent="primary"
              className="w-full shadow-md"
            >
              Install to Stremio
            </Button>
            <Button
              onClick={() =>
                window.open(
                  `https://web.stremio.com/#/addons?addon=${encodedManifest}`
                )
              }
              intent="gray-outline"
              className="w-full"
            >
              Install to Stremio Web
            </Button>
          </div>

          <div className="space-y-1.5 mt-2">
            <label className="text-xs font-medium text-gray-400 ml-1">
              Direct Manifest URL
            </label>
            <div className="flex items-center gap-2">
              <TextInput
                type="text"
                readOnly
                value={manifestUrl}
                className="flex-1 font-mono text-sm bg-black/20"
                onClick={(e) => e.currentTarget.select()}
              />
              <Button
                onClick={onCopyManifestUrl}
                intent="primary"
                className="shrink-0 px-3"
                aria-label="Copy install link"
              >
                <CopyIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div
          className="lg:col-span-5 xl:col-span-4 flex flex-col rounded-xl border border-gray-700 bg-gray-800/10 p-5 lg:overflow-hidden"
          style={
            isDesktop && stremioCardHeight
              ? { maxHeight: `${stremioCardHeight}px` }
              : undefined
          }
        >
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <div className="h-px bg-gray-700 flex-1"></div>
            Other apps
            <div className="h-px bg-gray-700 flex-1"></div>
          </h3>

          <div className="flex flex-col gap-3 flex-1 min-h-0 lg:overflow-y-auto pr-1">
            <AppCard
              logoSrc="https://link.chillio.app/app-icon.png"
              name="Chillio"
              description="Via ChillLink protocol"
              onClick={onOpenChillio}
            />
            <AppCard
              logoSrc="https://seanime.app/seanime-logo.png"
              name="Seanime"
              description="Anime-focused client"
              onClick={onOpenSeanime}
              disabled={disableSeanimeCard}
              disabledReason={seanimeDisabledReason}
            />
            <AppCard
              logoSrc="https://raw.githubusercontent.com/jellyfin/jellyfin-ux/refs/heads/master/logos/PNG-4x/jellyfin-icon--color-on-dark.png"
              name="Jellyfin"
              description="Via Gelato plugin"
              unofficial
              author="lostb1t"
              onClick={onOpenJellyfin}
            />
            <AppCard
              logoSrc="https://aniyomi.org/img/logo-128px.png"
              name="Aniyomi / Animiru"
              description="Extension-based integration"
              unofficial
              author="worldInColors"
              onClick={onOpenAniyomi}
            />
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

interface BackupCardProps {
  onExportOpen: () => void;
  onImportOpen: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  importFileRef: React.RefObject<HTMLInputElement | null>;
}

function BackupCard({
  onExportOpen,
  onImportOpen,
  onImport,
  importFileRef,
}: BackupCardProps) {
  return (
    <SettingsCard
      title="Backups"
      description="Export your settings or restore from a backup file"
    >
      <div className="flex flex-wrap gap-3">
        <Button onClick={onExportOpen} leftIcon={<UploadIcon />} intent="gray">
          Export
        </Button>
        <input
          type="file"
          accept=".json"
          className="hidden"
          id="import-file"
          onChange={onImport}
          ref={importFileRef}
        />
        <Button
          onClick={onImportOpen}
          leftIcon={<DownloadIcon />}
          intent="gray"
        >
          Import
        </Button>
      </div>
    </SettingsCard>
  );
}

interface DangerZoneCardProps {
  hasUser: boolean;
  onChangePasswordOpen: () => void;
  onDeleteUserOpen: () => void;
  onResetOpen: () => void;
}

function DangerZoneCard({
  hasUser,
  onChangePasswordOpen,
  onDeleteUserOpen,
  onResetOpen,
}: DangerZoneCardProps) {
  return (
    <SettingsCard
      title="Danger Zone"
      description="Perform potentially destructive actions that cannot be undone"
      className="lg:bg-red-950/70 border-red-500/20"
      titleClassName="group-hover/settings-card:from-red-500/10 group-hover/settings-card:to-red-950/20"
    >
      <div className="flex flex-wrap items-center gap-3">
        {hasUser && (
          <>
            <Button intent="alert" rounded onClick={onChangePasswordOpen}>
              Change Password
            </Button>
            <Button intent="alert" rounded onClick={onDeleteUserOpen}>
              Delete User
            </Button>
          </>
        )}
        <Button intent="alert" rounded onClick={onResetOpen}>
          Reset Configuration
        </Button>
      </div>
    </SettingsCard>
  );
}

// ---- Stremio Catalog Custom Source modal --------------------------------

type ManifestExtra = { name: string; isRequired?: boolean };
type ManifestCatalog = {
  id: string;
  type: string;
  name: string;
  extra?: ManifestExtra[];
};
type FetchedManifest = {
  name: string;
  logo?: string;
  catalogs: ManifestCatalog[];
};

type CatalogEntry = {
  id: string;
  type: string;
  name: string;
  hasSearch: boolean;
  searchRequired: boolean;
  displayName: string;
  selected: boolean;
};

interface StremioCustomSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseUrl: string;
  initialManifestUrl: string;
}

const DEFAULT_NAME_TEMPLATE = '{catalog.name} - {catalog.type}';

const STREMIO_CUSTOM_SOURCE_STORAGE_KEYS = {
  manifestUrl: 'aiostreams:seanime:stremio-custom-source:manifest-url',
  nameTemplate: 'aiostreams:seanime:stremio-custom-source:name-template',
  catalogSelections:
    'aiostreams:seanime:stremio-custom-source:catalog-selections',
} as const;

type PersistedCatalogSelection = {
  selected: boolean;
  displayName: string;
};

const toTitleCase = (value: string): string =>
  value
    .split(' ')
    .map((word) => word.toLowerCase())
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const templateStringModifiers: Record<string, (value: string) => string> = {
  title: toTitleCase,
  upper: (value) => value.toUpperCase(),
  lower: (value) => value.toLowerCase(),
  length: (value) => value.length.toString(),
};

const getCatalogSelectionKey = (catalog: { id: string; type: string }) =>
  `${catalog.type}::${catalog.id}`;

const safeGetLocalStorageItem = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSetLocalStorageItem = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // noop
  }
};

const safeRemoveLocalStorageItem = (key: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // noop
  }
};

const getPersistedCatalogSelections = (): Record<
  string,
  PersistedCatalogSelection
> => {
  const raw = safeGetLocalStorageItem(
    STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.catalogSelections
  );
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

function applyNameTemplate(
  template: string,
  ctx: { addonName: string; catalogName: string; catalogType: string }
): string {
  const valueContext: Record<string, Record<string, string>> = {
    addon: {
      name: ctx.addonName,
    },
    catalog: {
      name: ctx.catalogName,
      type: ctx.catalogType,
    },
  };

  return template.replace(
    /\{([a-z]+)\.([a-z]+)((?:::[^{}:\s]+)*)\}/gi,
    (match, namespace, key, modifierPart) => {
      const rawValue = valueContext[namespace]?.[key];

      if (typeof rawValue !== 'string') return match;

      const modifiers =
        typeof modifierPart === 'string' && modifierPart.length > 0
          ? modifierPart
              .split('::')
              .map((mod) => mod.trim().toLowerCase())
              .filter(Boolean)
          : [];

      return modifiers.reduce((result, mod) => {
        const modifier = templateStringModifiers[mod];
        return modifier ? modifier(result) : result;
      }, rawValue);
    }
  );
}

function StremioCustomSourceModal({
  open,
  onOpenChange,
  baseUrl,
  initialManifestUrl,
}: StremioCustomSourceModalProps) {
  const [step, setStep] = React.useState<'url' | 'catalogs' | 'import'>('url');
  const [manifestUrl, setManifestUrl] = React.useState(initialManifestUrl);
  const [manifest, setManifest] = React.useState<FetchedManifest | null>(null);
  const [catalogs, setCatalogs] = React.useState<CatalogEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [importJson, setImportJson] = React.useState('');
  const [nameTemplate, setNameTemplate] = React.useState(DEFAULT_NAME_TEMPLATE);

  React.useEffect(() => {
    if (!open) {
      setStep('url');
      setManifest(null);
      setCatalogs([]);
      setError(null);
      setImportJson('');
      return;
    }

    const storedTemplate = safeGetLocalStorageItem(
      STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.nameTemplate
    );
    const storedManifestUrl = safeGetLocalStorageItem(
      STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.manifestUrl
    );

    if (storedManifestUrl === initialManifestUrl) {
      safeRemoveLocalStorageItem(
        STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.manifestUrl
      );
    }

    setManifestUrl(
      storedManifestUrl && storedManifestUrl !== initialManifestUrl
        ? storedManifestUrl
        : initialManifestUrl
    );
    setNameTemplate(storedTemplate || DEFAULT_NAME_TEMPLATE);
  }, [open, initialManifestUrl]);

  React.useEffect(() => {
    if (!open) return;
    safeSetLocalStorageItem(
      STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.nameTemplate,
      nameTemplate
    );
  }, [nameTemplate, open]);

  React.useEffect(() => {
    if (!open) return;
    const nextManifestUrl = manifestUrl.trim();
    if (!nextManifestUrl || nextManifestUrl === initialManifestUrl) {
      safeRemoveLocalStorageItem(
        STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.manifestUrl
      );
      return;
    }
    safeSetLocalStorageItem(
      STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.manifestUrl,
      nextManifestUrl
    );
  }, [manifestUrl, initialManifestUrl, open]);

  React.useEffect(() => {
    if (!open || catalogs.length === 0) return;

    const persistedSelections = catalogs.reduce<
      Record<string, PersistedCatalogSelection>
    >((acc, catalog) => {
      acc[getCatalogSelectionKey(catalog)] = {
        selected: catalog.selected,
        displayName: catalog.displayName,
      };
      return acc;
    }, {});

    safeSetLocalStorageItem(
      STREMIO_CUSTOM_SOURCE_STORAGE_KEYS.catalogSelections,
      JSON.stringify(persistedSelections)
    );
  }, [catalogs, open]);

  const fetchManifest = async () => {
    const url = manifestUrl.trim();
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data: FetchedManifest = await res.json();
      if (!Array.isArray(data.catalogs) || data.catalogs.length === 0) {
        setError('This manifest has no catalogs.');
        return;
      }
      setManifest(data);
      const persistedSelections = getPersistedCatalogSelections();
      setCatalogs(
        data.catalogs.map((cat) => {
          const searchExtra = cat.extra?.find((e) => e.name === 'search');
          const persistedCatalog =
            persistedSelections[getCatalogSelectionKey(cat)];
          const defaultDisplayName = applyNameTemplate(nameTemplate, {
            addonName: data.name,
            catalogName: cat.name,
            catalogType: cat.type,
          });
          // preselect if
          //  - previously selected, or
          //  - does not have a non-search required extra. (non search extras cannot be provided via seanime)
          const preselected =
            persistedCatalog?.selected ??
            cat.extra?.find(
              (e) => e.name !== 'search' && e.isRequired === true
            ) === undefined;

          return {
            id: cat.id,
            type: cat.type,
            name: cat.name,
            hasSearch: !!searchExtra,
            searchRequired: searchExtra?.isRequired === true,
            displayName: persistedCatalog?.displayName || defaultDisplayName,
            selected: preselected,
          };
        })
      );
      setStep('catalogs');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to fetch manifest. Check the URL and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const buildExtensionUrl = (catalog: CatalogEntry) => {
    const logo = manifest?.logo?.startsWith('http')
      ? manifest.logo
      : 'https://raw.githubusercontent.com/Stremio/stremio-brand/refs/heads/master/logos/PNG/stremio-logo-800px.png';
    const catalogData = {
      id: catalog.id,
      type: catalog.type,
      name: catalog.displayName,
      addonManifestUrl: manifestUrl.trim(),
      addonLogo: logo,
    };
    const encoded = btoa(
      unescape(encodeURIComponent(JSON.stringify(catalogData)))
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `${baseUrl}/seanime/extensions/${encoded}/stremio-custom-source.json`;
  };

  const selectedCount = catalogs.filter((c) => c.selected).length;
  const allSelected = catalogs.length > 0 && catalogs.every((c) => c.selected);
  const selectAllState: boolean | 'indeterminate' =
    selectedCount === 0 ? false : allSelected ? true : 'indeterminate';

  const handleContinue = () => {
    const selected = catalogs.filter((c) => c.selected);
    if (!selected.length) {
      setError('Select at least one catalog.');
      return;
    }
    setError(null);
    setImportJson(JSON.stringify({ urls: selected.map(buildExtensionUrl) }));
    setStep('import');
  };

  const toggleAll = () => {
    setCatalogs((prev) => prev.map((c) => ({ ...c, selected: !allSelected })));
  };

  const applyTemplateToSelected = () => {
    if (!manifest) return;
    setCatalogs((prev) =>
      prev.map((c) =>
        c.selected
          ? {
              ...c,
              displayName: applyNameTemplate(nameTemplate, {
                addonName: manifest.name,
                catalogName: c.name,
                catalogType: c.type,
              }),
            }
          : c
      )
    );
    toast.success(
      `Renamed ${selectedCount} catalog${selectedCount !== 1 ? 's' : ''}`
    );
  };

  const stepDescriptions: Record<typeof step, string> = {
    url: 'Enter a Stremio addon manifest URL to browse its catalogs.',
    catalogs: manifest
      ? `${catalogs.length} catalog${catalogs.length !== 1 ? 's' : ''} from ${manifest.name}. Pick the ones to expose as Seanime custom sources.`
      : '',
    import:
      'Paste this URL list in Seanime under Extensions → Add Extensions → Import from repository → Import all.',
  };

  const transition = {
    initial: { opacity: 0, x: 12 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -12 },
    transition: { duration: 0.18, ease: 'easeOut' as const },
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Stremio Custom Source"
      description={stepDescriptions[step]}
      contentClass="max-w-2xl"
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === 'url' && (
          <motion.div key="url" {...transition} className="space-y-4">
            <div className="flex gap-2">
              <TextInput
                value={manifestUrl}
                onValueChange={setManifestUrl}
                placeholder="https://…/manifest.json"
                className="flex-1 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchManifest();
                }}
              />
              <Button
                intent="white"
                rounded
                onClick={fetchManifest}
                loading={loading}
                className="shrink-0"
              >
                Continue
              </Button>
            </div>
            {error && (
              <Alert intent="alert" description={error} isClosable={false} />
            )}
          </motion.div>
        )}

        {step === 'catalogs' && (
          <motion.div key="catalogs" {...transition} className="space-y-4">
            {manifest && (
              <div className="flex items-center gap-3 pb-3 border-b border-gray-700/50">
                {manifest.logo && (
                  <img
                    src={manifest.logo}
                    alt={manifest.name}
                    className="h-8 w-8 rounded object-contain bg-gray-900 p-1"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-100 truncate">
                    {manifest.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedCount} of {catalogs.length} selected
                  </p>
                </div>
                <IconButton
                  size="sm"
                  rounded
                  intent={allSelected ? 'primary' : 'primary-subtle'}
                  icon={
                    allSelected ? (
                      <LuSquareMinus className="w-4 h-4" />
                    ) : (
                      <LuSquareCheck className="w-4 h-4" />
                    )
                  }
                  onClick={toggleAll}
                  title={allSelected ? 'Deselect all' : 'Select all'}
                />
              </div>
            )}

            <div className="flex flex-col gap-1 max-h-80 overflow-y-auto -mx-1 px-1">
              {catalogs.map((cat, idx) => (
                <div
                  key={`${cat.type}-${cat.id}`}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                    cat.selected
                      ? 'bg-[--brand]/5 hover:bg-[--brand]/10'
                      : 'hover:bg-gray-800/40'
                  }`}
                >
                  <div className="flex-shrink-0">
                    <Checkbox
                      id={`cat-${idx}`}
                      size="sm"
                      value={cat.selected}
                      onValueChange={(val) =>
                        setCatalogs((prev) =>
                          prev.map((c, i) =>
                            i === idx ? { ...c, selected: val === true } : c
                          )
                        )
                      }
                    />
                  </div>
                  <div
                    className="flex-shrink-0 w-36 cursor-pointer"
                    onClick={() =>
                      setCatalogs((prev) =>
                        prev.map((c, i) =>
                          i === idx ? { ...c, selected: !c.selected } : c
                        )
                      )
                    }
                  >
                    <p className="text-sm font-medium text-gray-100 truncate">
                      {cat.name}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-500">
                      <span className="capitalize">{cat.type}</span>
                      {cat.hasSearch && (
                        <>
                          <span className="text-gray-700">·</span>
                          <span
                            className={`flex items-center gap-0.5 ${
                              cat.searchRequired
                                ? 'text-amber-400/80'
                                : 'text-gray-500'
                            }`}
                          >
                            <SearchIcon className="h-2.5 w-2.5" />
                            {cat.searchRequired ? 'search only' : 'searchable'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <TextInput
                      value={cat.displayName}
                      onValueChange={(val) =>
                        setCatalogs((prev) =>
                          prev.map((c, i) =>
                            i === idx ? { ...c, displayName: val } : c
                          )
                        )
                      }
                      className="w-full text-xs"
                      placeholder="Display name in Seanime"
                    />
                  </div>
                </div>
              ))}
            </div>

            <AnimatePresence initial={false}>
              {selectedCount > 0 && (
                <motion.div
                  key="rename-bar"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-gray-700/60 bg-gray-800/30 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <TextInput
                        value={nameTemplate}
                        onValueChange={setNameTemplate}
                        placeholder={DEFAULT_NAME_TEMPLATE}
                        className="flex-1 font-mono text-xs"
                        leftIcon={<LuWand className="w-3.5 h-3.5" />}
                      />
                      <Button
                        intent="primary-subtle"
                        size="sm"
                        onClick={applyTemplateToSelected}
                        className="shrink-0"
                      >
                        Apply to {selectedCount}
                      </Button>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Variables:{' '}
                      <code className="text-gray-400">{'{addon.name}'}</code>,{' '}
                      <code className="text-gray-400">{'{catalog.name}'}</code>,{' '}
                      <code className="text-gray-400">{'{catalog.type}'}</code>
                      {' · '}Modifiers:{' '}
                      <code className="text-gray-400">
                        {'{catalog.type::title}'}
                      </code>
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <Alert intent="alert" description={error} isClosable={false} />
            )}

            <div className="flex justify-between pt-2">
              <Button
                intent="gray-outline"
                rounded
                onClick={() => {
                  setStep('url');
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button
                intent="white"
                rounded
                onClick={handleContinue}
                disabled={selectedCount === 0}
              >
                Continue with {selectedCount} catalog
                {selectedCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 'import' && (
          <motion.div key="import" {...transition} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400 ml-1">
                URL list JSON
              </label>
              <div className="flex items-center gap-2">
                <TextInput
                  type="text"
                  readOnly
                  value={importJson}
                  className="flex-1 font-mono text-sm bg-black/20"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={() =>
                    copyToClipboard(importJson, {
                      onSuccess: () => toast.success('Copied to clipboard'),
                      onError: () => toast.error('Failed to copy'),
                    })
                  }
                  intent="primary"
                  className="shrink-0 px-3"
                  aria-label="Copy URL list"
                >
                  <CopyIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button
                intent="gray-outline"
                rounded
                onClick={() => {
                  setStep('catalogs');
                  setError(null);
                }}
              >
                Back
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

export function SaveInstallMenu() {
  return (
    <>
      <PageWrapper className="space-y-4 p-4 sm:p-8">
        <Content />
      </PageWrapper>
    </>
  );
}

function Content() {
  const {
    userData,
    setUserData,
    uuid,
    setUuid,
    password,
    setPassword,
    encryptedPassword,
    setEncryptedPassword,
  } = useUserData();
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmNewPassword, setConfirmNewPassword] = React.useState('');
  const [createLoading, setCreateLoading] = React.useState(false);
  const [passwordRequirements, setPasswordRequirements] = React.useState<
    string[]
  >([]);
  const { status } = useStatus();
  const baseUrl = status?.settings?.baseUrl || window.location.origin;
  const hasStatus = !!status;
  const searchApiDisabled = status?.settings?.searchApiDisabled ?? false;
  const seanimeExtensionVersion =
    status?.settings?.seanimeExtensionVersion ?? null;
  const isSeanimeVersionUnavailable =
    hasStatus && !searchApiDisabled && !seanimeExtensionVersion;
  const disableSeanimeCard = searchApiDisabled || isSeanimeVersionUnavailable;
  const seanimeDisabledReason = searchApiDisabled
    ? 'Requires Search API (disabled on this instance)'
    : isSeanimeVersionUnavailable
      ? 'Unavailable on this instance. Please ask your instance hoster.'
      : undefined;
  const importFileRef = React.useRef<HTMLInputElement>(null);
  const deleteUserModal = useDisclosure(false);
  const [confirmDeletionPassword, setConfirmDeletionPassword] =
    React.useState('');
  const { setSelectedMenu, firstMenu } = useMenu();
  const templateExportModal = useDisclosure(false);
  const templatesModal = useDisclosure(false);
  const exportMenuModal = useDisclosure(false);
  const importMenuModal = useDisclosure(false);
  const [filterCredentialsInExport, setFilterCredentialsInExport] =
    React.useState(true);
  const chillLinkModal = useDisclosure(false);
  const seanimeModal = useDisclosure(false);
  const stremioCustomSourceModal = useDisclosure(false);
  const jellyfinModal = useDisclosure(false);
  const aniyomiModal = useDisclosure(false);
  const [addonPasswordModalOpen, setAddonPasswordModalOpen] =
    React.useState(false);
  const { handleSave: handleSaveContext, loading: saveLoading } = useSave();
  const confirmResetProps = useConfirmationDialog({
    title: 'Confirm Reset',
    description: `Are you sure you want to reset your configuration? This will clear all your settings${uuid ? ` but keep your user account` : ''}. This action cannot be undone.`,
    actionText: 'Reset',
    actionIntent: 'alert',
    onConfirm: () => {
      setUserData(null);
      setSelectedMenu(firstMenu);
      toast.success('Configuration reset successfully');
    },
  });
  const confirmDelete = useConfirmationDialog({
    title: 'Confirm Deletion',
    description:
      'Are you sure you want to delete your configuration? This will permanently remove all your data. This action cannot be undone.',
    actionText: 'Delete',
    actionIntent: 'alert',
    onConfirm: () => {
      setCreateLoading(true);
      handleDelete();
    },
  });
  React.useEffect(() => {
    const requirements: string[] = [];

    // already created a config
    if (uuid && password) {
      setPasswordRequirements([]);
      return;
    }

    if (newPassword.length < 6) {
      requirements.push('Password must be at least 6 characters long');
    }

    if (confirmNewPassword.length > 0 && newPassword !== confirmNewPassword) {
      requirements.push('Passwords do not match');
    }

    setPasswordRequirements(requirements);
  }, [newPassword, confirmNewPassword, uuid, password]);

  const handleCreate = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (passwordRequirements.length > 0) {
      toast.error('Password requirements not met');
      return;
    }
    setCreateLoading(true);
    try {
      const result = await createUserConfig(userData, newPassword);
      toast.success(
        'Configuration created successfully, your UUID and password are below'
      );
      setUuid(result.uuid);
      setEncryptedPassword((result as CreateUserResponse).encryptedPassword);
      setPassword(newPassword);
    } catch (err) {
      if (err instanceof APIError && err.is('ADDON_PASSWORD_INVALID')) {
        setUserData((prev) => ({ ...prev, addonPassword: '' }));
        setAddonPasswordModalOpen(true);
        return;
      }
      toast.error(
        err instanceof Error ? err.message : 'Failed to create configuration'
      );
    } finally {
      setCreateLoading(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.metadata) {
          toast.error(
            'The imported file is a template, please use the template import option instead.'
          );
          return;
        }
        delete parsed.uuid;
        delete parsed.trusted;
        setUserData((prev) => ({
          ...prev,
          ...applyMigrations(parsed),
        }));
        toast.success('Configuration imported successfully');
      } catch (err) {
        toast.error('Failed to import configuration: Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const filterCredentials = (data: UserData): UserData => {
    const clonedData = structuredClone(data);

    return {
      ...clonedData,
      ip: undefined,
      uuid: undefined,
      addonPassword: undefined,
      tmdbAccessToken: undefined,
      tmdbApiKey: undefined,
      tvdbApiKey: undefined,
      rpdbApiKey: undefined,
      topPosterApiKey: undefined,
      aioratingsApiKey: undefined,
      aioratingsProfileId: undefined,
      services: clonedData?.services?.map((service) => ({
        ...service,
        credentials: {},
      })),
      proxy: {
        ...clonedData?.proxy,
        credentials: undefined,
        url: undefined,
        publicUrl: undefined,
      },
      presets: clonedData?.presets?.map((preset) => {
        const presetMeta = status?.settings.presets.find(
          (p) => p.ID === preset.type
        );
        return {
          ...preset,
          options: Object.fromEntries(
            Object.entries(preset.options || {}).filter(([key]) => {
              const optionMeta = presetMeta?.OPTIONS?.find(
                (opt) => opt.id === key
              );
              return optionMeta?.type !== 'password';
            })
          ),
        };
      }),
    };
  };

  const handleExport = () => {
    try {
      const exportData = filterCredentialsInExport
        ? filterCredentials(userData)
        : structuredClone(userData);
      const dataStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // format date as YYYY-MM-DD.HH-MM-SS
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const formattedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      a.download = `aiostreams-config-${formattedDate}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Configuration exported successfully');
      exportMenuModal.close();
    } catch (err) {
      toast.error('Failed to export configuration');
    }
  };
  const uuidRegex =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const manifestUrl = uuid
    ? uuidRegex.test(uuid)
      ? `${baseUrl}/stremio/${uuid}/${encryptedPassword}/manifest.json`
      : `${baseUrl}/stremio/u/${uuid}/manifest.json`
    : '';
  const chillLinkUrl = uuid
    ? `${baseUrl}/chilllink/${uuid}/${encryptedPassword}`
    : '';
  const encodedManifest = encodeURIComponent(manifestUrl);

  const hasSeanimePersonalUrl =
    !!uuid && !!encryptedPassword && uuidRegex.test(uuid);

  const seanimePluginUrl = hasSeanimePersonalUrl
    ? `${baseUrl}/seanime/${uuid}/${encryptedPassword}/extensions/aiostreams-plugin.json`
    : `${baseUrl}/seanime/extensions/aiostreams-plugin.json`;
  const seanimeProviderUrl = hasSeanimePersonalUrl
    ? `${baseUrl}/seanime/${uuid}/${encryptedPassword}/extensions/aiostreams-torrent-provider.json`
    : `${baseUrl}/seanime/extensions/aiostreams-torrent-provider.json`;
  const copyManifestUrl = async () => {
    await copyToClipboard(manifestUrl, {
      onSuccess: () => toast.success('Manifest URL copied to clipboard'),
      onError: () => toast.error('Failed to copy manifest URL'),
    });
  };

  const copyChillLinkUrl = async () => {
    await copyToClipboard(chillLinkUrl, {
      onSuccess: () => toast.success('ChillLink URL copied to clipboard'),
      onError: () => toast.error('Failed to copy ChillLink URL'),
    });
  };

  const copySeanimePluginUrl = async () => {
    await copyToClipboard(seanimePluginUrl, {
      onSuccess: () => toast.success('Plugin URL copied to clipboard'),
      onError: () => toast.error('Failed to copy URL'),
    });
  };

  const copySeanimeProviderUrl = async () => {
    await copyToClipboard(seanimeProviderUrl, {
      onSuccess: () =>
        toast.success('Torrent provider URL copied to clipboard'),
      onError: () => toast.error('Failed to copy URL'),
    });
  };

  const handleDelete = async () => {
    try {
      if (!uuid) {
        toast.error('No UUID found');
        return;
      }

      await deleteUserConfig(uuid, confirmDeletionPassword);

      // Only clear data after successful deletion
      toast.success('Configuration deleted successfully');
      setUuid(null);
      setEncryptedPassword(null);
      setPassword(null);
      setUserData(null);
      setSelectedMenu(firstMenu);
      deleteUserModal.close();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete configuration'
      );
    } finally {
      setCreateLoading(false);
    }
  };

  const changePasswordModal = useDisclosure(false);
  const [changePasswordLoading, setChangePasswordLoading] =
    React.useState(false);
  const [changePasswordData, setChangePasswordData] = React.useState({
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uuid) {
      toast.error('No UUID found');
      return;
    }
    if (changePasswordData.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters long');
      return;
    }
    if (
      changePasswordData.newPassword !== changePasswordData.confirmNewPassword
    ) {
      toast.error('New passwords do not match');
      return;
    }
    if (changePasswordData.newPassword === changePasswordData.currentPassword) {
      toast.error('New password cannot be the same as current password');
      return;
    }
    setChangePasswordLoading(true);
    try {
      const result = await changePassword(
        uuid,
        changePasswordData.currentPassword,
        changePasswordData.newPassword
      );

      toast.success(
        'Password changed successfully. Please reinstall AIOStreams.'
      );
      setPassword(changePasswordData.newPassword);
      setEncryptedPassword(result.encryptedPassword);
      changePasswordModal.close();
      setChangePasswordData({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to change password'
      );
    } finally {
      setChangePasswordLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Install Addon</h2>
          <p className="text-[--muted]">
            Configure and install your personalized Stremio addon
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <div className="space-y-4 mt-6">
        {!uuid ? (
          <CreateConfigCard
            onSubmit={handleCreate}
            passwordRequirements={passwordRequirements}
            newPassword={newPassword}
            confirmNewPassword={confirmNewPassword}
            onNewPasswordChange={setNewPassword}
            onConfirmNewPasswordChange={setConfirmNewPassword}
            createLoading={createLoading}
          />
        ) : (
          <>
            <SaveConfigCard
              uuid={uuid}
              onCopyUuid={() =>
                copyToClipboard(uuid, {
                  onSuccess: () => toast.success('UUID copied to clipboard'),
                  onError: () => toast.error('Failed to copy UUID'),
                })
              }
              onSave={(e) => {
                e.preventDefault();
                handleSaveContext();
              }}
              saveLoading={saveLoading}
              showChanges={userData?.showChanges ?? false}
              onShowChangesChange={(val) =>
                setUserData((prev) => ({ ...prev, showChanges: val }))
              }
            />

            <InstallCard
              baseUrl={baseUrl}
              uuid={uuid}
              encryptedPassword={encryptedPassword ?? ''}
              encodedManifest={encodedManifest}
              manifestUrl={manifestUrl}
              onCopyManifestUrl={copyManifestUrl}
              onOpenChillio={chillLinkModal.open}
              onOpenSeanime={seanimeModal.open}
              onOpenJellyfin={jellyfinModal.open}
              onOpenAniyomi={aniyomiModal.open}
              disableSeanimeCard={disableSeanimeCard}
              seanimeDisabledReason={seanimeDisabledReason}
            />
          </>
        )}

        <BackupCard
          onExportOpen={exportMenuModal.open}
          onImportOpen={importMenuModal.open}
          onImport={handleImport}
          importFileRef={importFileRef}
        />

        <DangerZoneCard
          hasUser={!!uuid}
          onChangePasswordOpen={changePasswordModal.open}
          onDeleteUserOpen={deleteUserModal.open}
          onResetOpen={confirmResetProps.open}
        />

        <Modal
          open={changePasswordModal.isOpen}
          onOpenChange={(open) => {
            if (changePasswordLoading) return;
            changePasswordModal.toggle();
            if (!open) {
              setChangePasswordData({
                currentPassword: '',
                newPassword: '',
                confirmNewPassword: '',
              });
            }
          }}
          title="Change Password"
          description={
            <Alert
              intent="warning"
              description="Changing your password will invalidate ALL existing installations. You will need to re-install AIOStreams after this change."
            />
          }
        >
          <form onSubmit={handleChangePassword} className="space-y-4">
            <PasswordInput
              id="change-current-password"
              label="Current Password"
              value={changePasswordData.currentPassword}
              required
              placeholder="Enter your current password"
              onValueChange={(value) =>
                setChangePasswordData((prev) => ({
                  ...prev,
                  currentPassword: value,
                }))
              }
            />
            <PasswordInput
              id="change-new-password"
              label="New Password"
              value={changePasswordData.newPassword}
              required
              placeholder="Enter your new password"
              onValueChange={(value) =>
                setChangePasswordData((prev) => ({
                  ...prev,
                  newPassword: value,
                }))
              }
            />
            <PasswordInput
              id="change-confirm-new-password"
              label="Confirm New Password"
              value={changePasswordData.confirmNewPassword}
              required
              placeholder="Re-enter your new password"
              onValueChange={(value) =>
                setChangePasswordData((prev) => ({
                  ...prev,
                  confirmNewPassword: value,
                }))
              }
            />
            <div className="pt-2 flex justify-end gap-3">
              <Button
                type="button"
                intent="gray-outline"
                onClick={() => {
                  if (!changePasswordLoading) changePasswordModal.close();
                }}
                disabled={changePasswordLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                intent="alert"
                loading={changePasswordLoading}
              >
                Change Password
              </Button>
            </div>
          </form>
        </Modal>

        <Modal
          open={deleteUserModal.isOpen}
          onOpenChange={deleteUserModal.toggle}
          title="Delete Configuration"
          description={
            <Alert
              intent="warning"
              description="Please enter your password to confirm deletion of your user and all associated data. This action cannot be undone."
            />
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!confirmDeletionPassword) {
                toast.error('Please enter your password');
                return;
              }
              confirmDelete.open();
            }}
          >
            <div className="space-y-4">
              <PasswordInput
                label="Password"
                value={confirmDeletionPassword}
                required
                placeholder="Enter your password to confirm deletion"
                onValueChange={(value) => setConfirmDeletionPassword(value)}
              />
              <div className="pt-2">
                <div className="grid grid-cols-2 gap-3 w-full">
                  <Button
                    type="button"
                    intent="gray-outline"
                    onClick={deleteUserModal.close}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    intent="alert"
                    loading={createLoading}
                    className="w-full"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Modal>
        {/* ChillLink modal */}
        <Modal
          open={chillLinkModal.isOpen}
          onOpenChange={chillLinkModal.toggle}
          title="Install in Chillio"
          description="Add your AIOStreams addon via the ChillLink protocol"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <TextInput
                type="text"
                readOnly
                value={chillLinkUrl}
                className="flex-1"
                onClick={(e) => e.currentTarget.select()}
              />
              <Button
                onClick={copyChillLinkUrl}
                intent="primary"
                className="shrink-0 px-3"
                aria-label="Copy ChillLink URL"
              >
                <CopyIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Modal>

        {/* Seanime modal */}
        <Modal
          open={seanimeModal.isOpen}
          onOpenChange={seanimeModal.toggle}
          title="Install in Seanime"
          description="Stream AIOStreams content directly within Seanime"
        >
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-400">
                Seanime integration is in{' '}
                <span className="font-medium text-amber-300">beta</span>
              </span>
              <span className="text-gray-400">
                Extension version:{' '}
                <span className="font-medium text-gray-200">
                  {seanimeExtensionVersion
                    ? `v${seanimeExtensionVersion}`
                    : 'Unavailable'}
                </span>
              </span>
            </div>

            <p className="text-xs text-gray-400">
              In Seanime, go to{' '}
              <span className="text-gray-200">
                Extensions → Add Extensions → Install from URL
              </span>
              . Install one of the two extensions below.
            </p>

            {/* Plugin option */}
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-white">
                  AIOStreams Plugin{' '}
                  <span className="text-xs text-gray-500 font-normal">
                    — recommended for most
                  </span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Adds a dedicated results panel and tab to Seanime. Works with
                  any URL or P2P based stream.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <TextInput
                  type="text"
                  readOnly
                  value={seanimePluginUrl}
                  className="flex-1"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={copySeanimePluginUrl}
                  intent="primary"
                  className="shrink-0 px-3"
                  aria-label="Copy plugin URL"
                >
                  <CopyIcon className="h-4 w-4" />
                </Button>
              </div>
              {!hasSeanimePersonalUrl && (
                <p className="text-xs text-gray-500">
                  After installing, open the extension settings and enter your
                  Manifest URL.
                </p>
              )}
            </div>

            <div className="border-t border-gray-700/60" />

            {/* Torrent provider option */}
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-white">
                  AIOStreams Torrent Provider
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  For native torrent integration. Only use this if you want a
                  simpler extension and/or want Seanime to handle debrid.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <TextInput
                  type="text"
                  readOnly
                  value={seanimeProviderUrl}
                  className="flex-1"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={copySeanimeProviderUrl}
                  intent="primary"
                  className="shrink-0 px-3"
                  aria-label="Copy torrent provider URL"
                >
                  <CopyIcon className="h-4 w-4" />
                </Button>
              </div>
              {!hasSeanimePersonalUrl && (
                <p className="text-xs text-gray-500">
                  After installing, open the extension settings and enter your
                  Manifest URL.
                </p>
              )}
            </div>

            <div className="border-t border-gray-700/60" />

            {/* Stremio Custom Source */}
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-white">
                  Stremio Custom Source
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Expose any Stremio addon catalog as a Seanime custom source to
                  browse its library directly inside Seanime.
                </p>
              </div>
              <Button
                intent="white"
                rounded
                className="w-full"
                onClick={stremioCustomSourceModal.open}
              >
                Configure
              </Button>
            </div>
          </div>
        </Modal>

        <StremioCustomSourceModal
          open={stremioCustomSourceModal.isOpen}
          onOpenChange={stremioCustomSourceModal.toggle}
          baseUrl={baseUrl}
          initialManifestUrl={manifestUrl}
        />

        <Modal
          open={jellyfinModal.isOpen}
          onOpenChange={jellyfinModal.toggle}
          title="AIOStreams for Jellyfin"
          description="Install the Gelato plugin to bring AIOStreams to Jellyfin"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              Gelato is an unofficial Jellyfin plugin that brings Stremio addons
              into Jellyfin.
            </p>
            <Button
              intent="primary"
              className="w-full"
              leftIcon={<FiExternalLink />}
              onClick={() =>
                window.open('https://github.com/lostb1t/Gelato', '_blank')
              }
            >
              Open Gelato on GitHub
            </Button>
          </div>
        </Modal>

        <Modal
          open={aniyomiModal.isOpen}
          onOpenChange={aniyomiModal.toggle}
          title="AIOStreams for Aniyomi / Animiru"
          description="Install the extension to use AIOStreams in Aniyomi and Animiru"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              This unofficial extension brings AIOStreams support to Aniyomi and
              forks (e.g. Animiru).
            </p>
            <Button
              intent="primary"
              className="w-full"
              leftIcon={<FiExternalLink />}
              onClick={() =>
                window.open(
                  'https://github.com/worldInColors/aiostreams-extension',
                  '_blank'
                )
              }
            >
              Open extension on GitHub
            </Button>
          </div>
        </Modal>

        <ConfirmationDialog {...confirmDelete} />
        <ConfirmationDialog {...confirmResetProps} />

        <AddonPasswordModal
          open={addonPasswordModalOpen}
          onOpenChange={setAddonPasswordModalOpen}
          loading={createLoading}
          onSubmit={() => {
            setAddonPasswordModalOpen(false);
            handleCreate();
          }}
          submitText="Create"
          value={userData.addonPassword ?? ''}
          onValueChange={(value) =>
            setUserData((prev) => ({ ...prev, addonPassword: value }))
          }
        />

        <Modal
          open={exportMenuModal.isOpen}
          onOpenChange={exportMenuModal.toggle}
          title="Export Configuration"
          description="Choose how to export your configuration"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <ModalOptionButton
                onClick={handleExport}
                icon={<UploadIcon className="h-8 w-8" />}
                title="Export Config"
                description="Download as JSON file for backup or sharing"
              />
              <ModalOptionButton
                onClick={() => {
                  exportMenuModal.close();
                  templateExportModal.open();
                }}
                icon={<PlusIcon className="h-8 w-8" />}
                title="Export as Template"
                description="Create reusable template with custom metadata"
              />
            </div>

            <div className="flex flex-col gap-3 mt-6 p-3 bg-gray-800/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">
                    Exclude Credentials
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Remove sensitive API keys and passwords from the export
                  </div>
                </div>
                <Switch
                  value={filterCredentialsInExport}
                  onValueChange={setFilterCredentialsInExport}
                />
              </div>
              <Alert
                intent="warning"
                isClosable={false}
                description="While excluding credentials removes your API keys, any custom addon URLs or manually overridden URLs in your config are not removed. These may contain sensitive information - double-check before sharing."
              />
            </div>
          </div>
        </Modal>

        <Modal
          open={importMenuModal.isOpen}
          onOpenChange={importMenuModal.toggle}
          title="Import Configuration"
          description="Choose what type of configuration to import"
        >
          <div className="grid grid-cols-2 gap-4">
            <ModalOptionButton
              onClick={() => {
                importMenuModal.close();
                importFileRef.current?.click();
              }}
              icon={<DownloadIcon className="h-8 w-8" />}
              title="Import Config"
              description="Restore from a backup JSON file"
            />
            <ModalOptionButton
              onClick={() => {
                importMenuModal.close();
                templatesModal.open();
              }}
              icon={<PlusIcon className="h-8 w-8" />}
              title="Import Template"
              description="Load a pre-configured template"
            />
          </div>
        </Modal>

        <TemplateExportModal
          open={templateExportModal.isOpen}
          onOpenChange={templateExportModal.toggle}
          userData={userData}
          filterCredentials={filterCredentials}
        />
        <ConfigTemplatesModal
          open={templatesModal.isOpen}
          onOpenChange={templatesModal.toggle}
          openImportModal
        />
      </div>
    </>
  );
}
