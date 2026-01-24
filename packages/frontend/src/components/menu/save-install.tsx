'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { applyMigrations, useUserData } from '@/context/userData';
import { UserConfigAPI } from '@/services/api';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Alert } from '@/components/ui/alert';
import { SettingsCard } from '../shared/settings-card';
import { toast } from 'sonner';
import { CopyIcon, DownloadIcon, PlusIcon, UploadIcon } from 'lucide-react';
import { useStatus } from '@/context/status';
import { BiCopy } from 'react-icons/bi';
import { copyToClipboard } from '@/utils/clipboard';
import { PageControls } from '../shared/page-controls';
import { useDisclosure } from '@/hooks/disclosure';
import { Modal } from '../ui/modal';
import { Switch } from '../ui/switch';
import { TemplateExportModal } from '../shared/template-export-modal';
import { ConfigTemplatesModal } from '../shared/config-templates-modal';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../ui/accordion';
import { Select } from '@/components/ui/select';
import { PasswordInput } from '../ui/password-input';
import { useMenu } from '@/context/menu';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../shared/confirmation-dialog';
import { UserData } from '@aiostreams/core';
import { DiffViewer } from '../shared/diff-viewer';
import { getObjectDiff, DiffItem } from '@/utils/diff';

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
      className="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-gray-700 bg-gradient-to-br from-gray-800/50 to-gray-800/30 p-6 text-center transition-all hover:border-brand-400 hover:from-brand-400/10 hover:to-brand-400/5 hover:shadow-lg hover:shadow-brand-400/20 hover:ring-1 hover:ring-brand-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-400"
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
  const [loading, setLoading] = React.useState(false);
  const [passwordRequirements, setPasswordRequirements] = React.useState<
    string[]
  >([]);
  const { status } = useStatus();
  const baseUrl = status?.settings?.baseUrl || window.location.origin;
  const importFileRef = React.useRef<HTMLInputElement>(null);
  const installModal = useDisclosure(false);
  const passwordModal = useDisclosure(false);
  const deleteUserModal = useDisclosure(false);
  const [confirmDeletionPassword, setConfirmDeletionPassword] =
    React.useState('');
  const { setSelectedMenu, firstMenu } = useMenu();
  const templateExportModal = useDisclosure(false);
  const templatesModal = useDisclosure(false);
  const exportMenuModal = useDisclosure(false);
  const importMenuModal = useDisclosure(false);
  const [filterCredentialsInExport, setFilterCredentialsInExport] =
    React.useState(false);
  const [installProtocol, setInstallProtocol] = React.useState('stremio');
  const [diffData, setDiffData] = React.useState<DiffItem[]>([]);
  const [remoteConfig, setRemoteConfig] = React.useState<UserData | null>(null);
  const diffModal = useDisclosure(false);
  const pendingSkipDiffRef = React.useRef(false);
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
      setLoading(true);
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

    setPasswordRequirements(requirements);
  }, [newPassword, uuid, password]);

  const handleRevertAll = () => {
    if (remoteConfig) {
      setUserData((prev) => (prev ? { ...prev, ...remoteConfig } : remoteConfig));
      toast.success('Changes reverted');
      diffModal.close();
    }
  };

  const handleSave = async (
    e?: React.FormEvent<HTMLFormElement>,
    authenticated: boolean = false,
    skipDiffHandler: boolean = false
  ) => {
    e?.preventDefault();
    const shouldSkipDiff = skipDiffHandler || pendingSkipDiffRef.current;
    pendingSkipDiffRef.current = false;

    let suppressSuccessToast = false;
    if (
      status?.settings.protected &&
      !authenticated &&
      !userData.addonPassword
    ) {
      pendingSkipDiffRef.current = shouldSkipDiff;
      passwordModal.open();
      return;
    }
    if (passwordRequirements.length > 0) {
      toast.error('Password requirements not met');
      return;
    }

    if (uuid && password && !shouldSkipDiff && userData?.showChanges) {
      setLoading(true);
      try {
        const remoteResult = await UserConfigAPI.loadConfig(uuid, password);
        
        if (remoteResult.success && remoteResult.data) {
          const diffs = getObjectDiff(remoteResult.data.config, userData);
          
          if (diffs.length === 0) {
            toast.info('No changes detected');
            suppressSuccessToast = true;
          } else {
            setRemoteConfig(remoteResult.data.config);
            setDiffData(diffs);
            diffModal.open();
            setLoading(false);
            return;
          }
        } else {
             toast.warning('Error checking for changes. Proceeding with save.');
        }
      } catch (err) {
        console.error('Error checking for changes:', err);
        toast.warning('Error checking for changes. Proceeding with save.');
        // Reset loading state before proceeding to actual save
        setLoading(false);
      }
    }

    setLoading(true);

    try {
      const result = uuid
        ? await UserConfigAPI.updateConfig(uuid, userData, password!)
        : await UserConfigAPI.createConfig(userData, newPassword);

      if (!result.success) {
        if (result.error?.code === 'USER_INVALID_DETAILS') {
          toast.error('Your addon password is incorrect');
          setUserData((prev) => ({
            ...prev,
            addonPassword: '',
          }));
          passwordModal.open();
          return;
        }
        throw new Error(
          result.error?.message || 'Failed to save configuration'
        );
      }

      if (!uuid && result.data) {
        toast.success(
          'Configuration created successfully, your UUID and password are below'
        );
        setUuid(result.data.uuid);
        setEncryptedPassword(result.data.encryptedPassword);
        setPassword(newPassword);
      } else if (uuid && result.success && !suppressSuccessToast) {
        toast.success('Configuration updated successfully');
      }

      if (authenticated) {
        passwordModal.close();
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save configuration'
      );
      if (authenticated) {
        passwordModal.close();
      }
    } finally {
      setLoading(false);
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

  const copyManifestUrl = async () => {
    await copyToClipboard(manifestUrl, {
      successMessage: 'Manifest URL copied to clipboard',
      errorMessage: 'Failed to copy manifest URL',
    });
  };

  const copyChillLinkUrl = async () => {
    await copyToClipboard(chillLinkUrl, {
      successMessage: 'ChillLink URL copied to clipboard',
      errorMessage: 'Failed to copy ChillLink URL',
    });
  };

  const handleDelete = async () => {
    try {
      if (!uuid) {
        toast.error('No UUID found');
        return;
      }

      const result = await UserConfigAPI.deleteUser(
        uuid,
        confirmDeletionPassword
      );

      if (!result.success) {
        if (result.error?.code === 'USER_INVALID_DETAILS') {
          toast.error('Invalid password');
        } else {
          toast.error(
            result.error?.message || 'Failed to delete configuration'
          );
        }
        return;
      }

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
      setLoading(false);
    }
  };

  const valueFormatter = React.useCallback((val: any): string => {
      const resolveId = (v: string) => {
          const addon = userData?.presets?.find(p => {
             if (p.instanceId === v) return true;
             const opts = p.options as Record<string, any>;
             return opts?.id === v;
          });
          if (addon) {
              const opts = addon.options as Record<string, any>;
              if (opts?.name && typeof opts.name === 'string') return opts.name;
          }
          return v;
      };

      const resolveDeep = (v: any): any => {
          // Swap IDs for names
          if (typeof v === 'string') return resolveId(v);
          if (Array.isArray(v)) return v.map(resolveDeep);
          if (v && typeof v === 'object') {
              return Object.fromEntries(
                  Object.entries(v).map(([k, val]) => [k, resolveDeep(val)])
              );
          }
          return v;
      };

      const resolved = resolveDeep(val);

      if (typeof resolved === 'object' && resolved !== null) {
          try {
              return JSON.stringify(resolved, null, 2);
          } catch {
              return '[Circular Reference]';
          }
      }
      return String(resolved);
  }, [userData?.presets]);

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
          <SettingsCard
            title="Create Configuration"
            description="Set up your personalised addon configuration"
          >
            <form onSubmit={handleSave} className="space-y-4">
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
                  onValueChange={(value) => setNewPassword(value)}
                  placeholder="Enter a password to protect your configuration"
                  required
                  autoComplete="new-password"
                />
                <p className="text-sm text-[--muted] mt-1">
                  This is the password you will use to access and update your
                  configuration later. You cannot change this or reset the
                  password once set, so please choose wisely, and remember it.
                </p>
              </div>
              <Button intent="white" type="submit" loading={loading} rounded>
                Create
              </Button>
            </form>
          </SettingsCard>
        ) : (
          <>
            <SettingsCard
              title="Save Configuration"
              description="Save your configuration to your account by clicking Update below."
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
                          onClick={() =>
                            copyToClipboard(uuid, {
                              successMessage: 'UUID copied to clipboard',
                            })
                          }
                        />
                      </div>
                      <p className="text-sm text-[--muted]">
                        Save your UUID and password - you'll need them to update
                        your configuration later
                      </p>
                    </div>
                  }
                  className="flex-1"
                />
              </div>
              <form onSubmit={handleSave}>
                <div className="flex items-center justify-between gap-4 mt-4">
                  <Button type="submit" intent="white" loading={loading} rounded>
                    Save
                  </Button>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="show-changes"
                      label="Show changes before saving"
                      value={userData?.showChanges ?? false}
                      onValueChange={(val) =>
                        setUserData((prev) => ({ ...prev, showChanges: val }))
                      }
                    />
                  </div>
                </div>
              </form>
            </SettingsCard>

            {/* <SettingsCard
              title="Install"
              description="Choose how you want to install your personalized addon. There is no need to reinstall the addon after updating your configuration above, unless you've updated your upstream addons."
            >
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() =>
                    window.open(
                      `stremio://${baseUrl.replace(/^https?:\/\//, '')}/stremio/${uuid}/${encryptedPassword}/manifest.json`
                    )
                  }
                >
                  Stremio Desktop
                </Button>
                <Button
                  onClick={() =>
                    window.open(
                      `https://web.stremio.com/#/addons?addon=${encodedManifest}`
                    )
                  }
                >
                  Stremio Web
                </Button>
                <Button onClick={copyManifestUrl}>Copy URL</Button>
              </div>
            </SettingsCard> */}

            <SettingsCard
              title="Install"
              description="Install your addon using your preferred method. There usually isn't a need to reinstall the addon after updating your configuration above, unless you use catalogs and you've changed the order of them or the addons that provide them"
            >
              <div className="flex justify-between items-center">
                <Button intent="white" rounded onClick={installModal.open}>
                  Install
                </Button>
                <div className="w-40">
                  <Select
                    options={[
                      { label: 'Stremio', value: 'stremio' },
                      { label: 'ChillLink', value: 'chilllink' },
                    ]}
                    value={installProtocol}
                    onValueChange={setInstallProtocol}
                  />
                </div>
              </div>

              <Modal
                open={installModal.isOpen}
                onOpenChange={installModal.toggle}
                title={`Install to ${installProtocol === 'stremio' ? 'Stremio' : 'Chillio'}`}
                description="Install your addon"
              >
                <div className="flex flex-col gap-4">
                  {installProtocol === 'stremio' && (
                    <>
                      <Button
                        onClick={() =>
                          window.open(
                            `stremio://${baseUrl.replace(/^https?:\/\//, '')}/stremio/${uuid}/${encryptedPassword}/manifest.json`
                          )
                        }
                        intent="primary"
                        className="w-full"
                      >
                        Stremio
                      </Button>
                      <Button
                        onClick={() =>
                          window.open(
                            `https://web.stremio.com/#/addons?addon=${encodedManifest}`
                          )
                        }
                        intent="primary"
                        className="w-full"
                      >
                        Stremio Web
                      </Button>
                    </>
                  )}

                  <div className="flex items-center gap-2 mt-2">
                    <TextInput
                      type="text"
                      readOnly
                      value={
                        installProtocol === 'stremio'
                          ? manifestUrl
                          : chillLinkUrl
                      }
                      className="flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <Button
                      onClick={
                        installProtocol === 'stremio'
                          ? copyManifestUrl
                          : copyChillLinkUrl
                      }
                      intent="primary"
                      className="shrink-0 px-3"
                      aria-label="Copy URL"
                    >
                      <CopyIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Modal>
            </SettingsCard>
          </>
        )}

        <Modal
          open={passwordModal.isOpen}
          onOpenChange={passwordModal.toggle}
          title="Addon Password"
          description="This instance is protected with a password. You must enter the password for this instance (NOT your user password you set earlier) to create a configuration here."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave(e, true);
            }}
          >
            <PasswordInput
              label="Addon Password"
              value={userData.addonPassword}
              required
              placeholder="Enter the password for this instance"
              onValueChange={(value) =>
                setUserData((prev) => ({
                  ...prev,
                  addonPassword: value,
                }))
              }
            />
            <Button type="submit" intent="white" loading={loading} rounded>
              Save
            </Button>
          </form>
        </Modal>

        <SettingsCard
          title="Backups"
          description="Export your settings or restore from a backup file"
        >
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={exportMenuModal.open}
              leftIcon={<UploadIcon />}
              intent="gray"
            >
              Export
            </Button>
            <input
              type="file"
              accept=".json"
              className="hidden"
              id="import-file"
              onChange={handleImport}
              ref={importFileRef}
            />
            <Button
              onClick={importMenuModal.open}
              leftIcon={<DownloadIcon />}
              intent="gray"
            >
              Import
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Danger Zone"
          description="Perform potentially destructive actions that cannot be undone"
          className="lg:bg-red-950/70 border-red-500/20"
          titleClassName="group-hover/settings-card:from-red-500/10 group-hover/settings-card:to-red-950/20"
        >
          <div className="flex items-center gap-3">
            {uuid && (
              <Button intent="alert" rounded onClick={deleteUserModal.open}>
                Delete User
              </Button>
            )}
            <Button intent="alert" rounded onClick={confirmResetProps.open}>
              Reset Configuration
            </Button>
          </div>
        </SettingsCard>

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
                    loading={loading}
                    className="w-full"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Modal>
        <ConfirmationDialog {...confirmDelete} />
        <ConfirmationDialog {...confirmResetProps} />

        <Modal
          open={exportMenuModal.isOpen}
          onOpenChange={exportMenuModal.toggle}
          title="Export Configuration"
          description="Choose how to export your configuration"
        >
          <div className="space-y-4">
            {/* Exclude Credentials Option */}
            <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
              <div className="flex-1">
                <div className="text-sm font-medium text-white">
                  Exclude Credentials
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Remove sensitive information from export
                </div>
              </div>
              <Switch
                value={filterCredentialsInExport}
                onValueChange={setFilterCredentialsInExport}
              />
            </div>

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

        <Modal
          open={diffModal.isOpen}
          onOpenChange={diffModal.toggle}
          title="Confirm Changes"
          description="Review the changes you are about to make to your configuration."
        >
          <div className="space-y-4">
            <DiffViewer diffs={diffData} valueFormatter={valueFormatter} />
            <div className="flex justify-between pt-4">
              <Button
                intent="alert"
                onClick={handleRevertAll}
                disabled={loading}
              >
                Reset Changes
              </Button>
              <div className="flex gap-3">
                <Button
                  intent="gray-outline"
                  onClick={diffModal.close}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  intent="white"
                  onClick={() => {
                    diffModal.close();
                    handleSave(undefined, undefined, true);
                  }}
                  loading={loading}
                >
                  Confirm & Save
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
}
