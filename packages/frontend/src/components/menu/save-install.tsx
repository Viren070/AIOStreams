'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { useUserData } from '@/context/userData';
import { UserConfigAPI } from '@/services/api';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Alert } from '@/components/ui/alert';
import { SettingsCard } from '../shared/settings-card';
import { toast } from 'sonner';
import { DownloadIcon, UploadIcon, BrushCleaningIcon } from 'lucide-react';
import { useStatus } from '@/context/status';
import { BiCopy } from 'react-icons/bi';
import { PageControls } from '../shared/page-controls';
import { useDisclosure } from '@/hooks/disclosure';
import { Modal } from '../ui/modal';
import { Switch } from '../ui/switch';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../ui/accordion';
import { PasswordInput } from '../ui/password-input';
import { useMenu } from '@/context/menu';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../shared/confirmation-dialog';
import { UserData } from '@aiostreams/core';

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
    clearUserData,
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
  const [filterCredentialsInExport, setFilterCredentialsInExport] =
    React.useState(false);
  const deleteModal = useDisclosure(false);
  const [deletePassword, setDeletePassword] = React.useState('');
  const { setSelectedMenu, firstMenu } = useMenu();
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

  const handleSave = async (
    e?: React.FormEvent<HTMLFormElement>,
    authenticated: boolean = false
  ) => {
    e?.preventDefault();
    if (
      status?.settings.protected &&
      !authenticated &&
      !userData.addonPassword
    ) {
      passwordModal.open();
      return;
    }
    if (passwordRequirements.length > 0) {
      toast.error('Password requirements not met');
      return;
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
      } else if (uuid && result.success) {
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
        const json = JSON.parse(event.target?.result as string);
        // const validate = UserDataSchema.safeParse(json);
        // if (!validate.success) {
        //   toast.error('Failed to import configuration: Invalid JSON file');
        //   return;
        // }
        setUserData((prev) => ({
          ...prev,
          ...json,
        }));
        toast.success('Configuration imported successfully');
      } catch (err) {
        toast.error('Failed to import configuration: Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    try {
      const filteredUserData: UserData = {
        ...userData,
        ip: filterCredentialsInExport ? undefined : userData.ip,
        uuid: filterCredentialsInExport ? undefined : userData.uuid,
        addonPassword: filterCredentialsInExport
          ? undefined
          : userData.addonPassword,
        tmdbAccessToken: filterCredentialsInExport
          ? undefined
          : userData.tmdbAccessToken,
        tmdbApiKey: filterCredentialsInExport ? undefined : userData.tmdbApiKey,
        rpdbApiKey: filterCredentialsInExport ? undefined : userData.rpdbApiKey,
        services: userData?.services?.map((service) => ({
          ...service,
          credentials: filterCredentialsInExport ? {} : service.credentials,
        })),
        proxy: {
          ...userData?.proxy,
          credentials: filterCredentialsInExport
            ? undefined
            : userData?.proxy?.credentials,
          url: filterCredentialsInExport ? undefined : userData?.proxy?.url,
          publicUrl: filterCredentialsInExport
            ? undefined
            : userData?.proxy?.publicUrl,
        },
        presets: userData?.presets?.map((preset) => {
          const presetMeta = status?.settings.presets.find(
            (p) => p.ID === preset.type
          );
          return {
            ...preset,
            options: filterCredentialsInExport
              ? Object.fromEntries(
                  Object.entries(preset.options || {}).filter(([key]) => {
                    const optionMeta = presetMeta?.OPTIONS?.find(
                      (opt) => opt.id === key
                    );
                    return optionMeta?.type !== 'password';
                  })
                )
              : preset.options,
          };
        }),
      };
      const dataStr = JSON.stringify(filteredUserData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aiostreams-config.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Failed to export configuration');
    }
  };

  const manifestUrl = `${baseUrl}/stremio/${uuid}/${encryptedPassword}/manifest.json`;
  const encodedManifest = encodeURIComponent(manifestUrl);

  const copyManifestUrl = async () => {
    try {
      if (!navigator.clipboard) {
        toast.error(
          'The Clipboard API is not supported on this browser or context, please manually copy the URL'
        );
        return;
      }
      await navigator.clipboard.writeText(manifestUrl);
      toast.success('Manifest URL copied to clipboard');
    } catch (err) {
      toast.error('Failed to copy manifest URL');
    }
  };

  const handleDelete = async () => {
    try {
      if (!uuid) {
        toast.error('No UUID found');
        return;
      }

      const result = await UserConfigAPI.deleteUser(uuid, deletePassword);

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
      deleteModal.close();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete configuration'
      );
    } finally {
      setLoading(false);
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
        <SettingsCard title="Current Changes">
          <Button
            onClick={clearUserData}
            intent="gray"
            leftIcon={<BrushCleaningIcon />}
            type="button"
          >
            Reset to Defaults
          </Button>
        </SettingsCard>
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
                          onClick={() => {
                            navigator.clipboard.writeText(uuid);
                            toast.success('UUID copied to clipboard');
                          }}
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
                <Button type="submit" intent="white" loading={loading} rounded>
                  Save
                </Button>
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
              <Button intent="white" rounded onClick={installModal.open}>
                Install
              </Button>

              <Modal
                open={installModal.isOpen}
                onOpenChange={installModal.toggle}
                title="Install"
                description="Install your addon"
              >
                <div className="flex flex-col gap-4">
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
                  <Button
                    onClick={copyManifestUrl}
                    intent="primary"
                    className="w-full"
                  >
                    Copy URL
                  </Button>
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
          <div className="flex gap-3">
            <Button
              onClick={handleExport}
              leftIcon={<UploadIcon />}
              intent="gray"
            >
              Export
            </Button>
            <div>
              <input
                type="file"
                accept=".json"
                className="hidden"
                id="import-file"
                onChange={handleImport}
                ref={importFileRef}
              />
              <label htmlFor="import-file">
                <Button
                  intent="gray"
                  leftIcon={<DownloadIcon />}
                  type="button"
                  className="cursor-pointer"
                  onClick={() => importFileRef.current?.click()}
                >
                  Import
                </Button>
              </label>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4 w-full">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="export-settings" className="w-full">
                <AccordionTrigger className="w-full">
                  Export Settings
                </AccordionTrigger>
                <AccordionContent className="w-full">
                  <div className="flex items-center justify-between w-full">
                    <Switch
                      value={filterCredentialsInExport ?? false}
                      onValueChange={(value) =>
                        setFilterCredentialsInExport(value)
                      }
                      side="right"
                      help="This will not exclude any URLs you have provided, these may contain credentials and you should always double check the contents of the exported file before sharing it."
                      label="Exclude Credentials"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </SettingsCard>

        {uuid && (
          <SettingsCard
            title="Delete Configuration"
            description="Delete your configuration and all associated data"
          >
            <Button intent="alert" rounded onClick={deleteModal.open}>
              Delete
            </Button>
          </SettingsCard>
        )}

        <Modal
          open={deleteModal.isOpen}
          onOpenChange={deleteModal.toggle}
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
              if (!deletePassword) {
                toast.error('Please enter your password');
                return;
              }
              confirmDelete.open();
            }}
          >
            <div className="space-y-4">
              <PasswordInput
                label="Password"
                value={deletePassword}
                required
                placeholder="Enter your password to confirm deletion"
                onValueChange={(value) => setDeletePassword(value)}
              />
              <div className="pt-2">
                <div className="grid grid-cols-2 gap-3 w-full">
                  <Button
                    type="button"
                    intent="gray-outline"
                    onClick={deleteModal.close}
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
      </div>
    </>
  );
}
