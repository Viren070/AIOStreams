'use client';
import { useStatus } from '@/context/status';
import { useServiceExpiry } from '@/hooks/useServiceExpiry';
import {
  canServiceAutoFetch,
  getExpiryPreference,
  isTrackedService,
  setExpiryPreference,
  type ExpiryMode,
} from '@/utils/service-expiry';
import { PageWrapper } from '../shared/page-wrapper';
import {
  // SERVICE_DETAILS,
  ServiceId,
} from '../../../../core/src/utils/constants';
import { useUserData } from '@/context/userData';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconButton } from '../ui/button';
import { FiArrowLeft, FiArrowRight, FiSettings } from 'react-icons/fi';
import { Switch } from '../ui/switch';
import { Modal } from '../ui/modal';
import { useState, useEffect } from 'react';
import {
  DndContext,
  useSensors,
  PointerSensor,
  TouchSensor,
  useSensor,
} from '@dnd-kit/core';
import TemplateOption from '../shared/template-option';
import { Button } from '../ui/button';
import MarkdownLite from '../shared/markdown-lite';
import { Alert } from '../ui/alert';
import { useMenu } from '@/context/menu';
import { PageControls } from '../shared/page-controls';
import { SettingsCard } from '../shared/settings-card';
import { TextInput } from '../ui/text-input';
import { PasswordInput } from '../ui/password-input';
import { Select } from '../ui/select';
import { StatusResponse, UserData } from '@aiostreams/core';
import { ServiceExpiryBadge } from './service-expiry-badge';
import { ServiceExpiryDatePicker } from './service-expiry-date-picker';
export function ServicesMenu() {
  return (
    <>
      <PageWrapper className="space-y-4 p-4 sm:p-8">
        <Content />
      </PageWrapper>
    </>
  );
}

// we  show all services, along with its signUpText and a setting icon button, and switch to enable/disable the service.
// this will be in a sortable lis twith dnd, similar to the addons menu.
// when the setting icon button is clicked, it will open a modal with all the credentials (option definitions) for the service

//

function Content() {
  const { status } = useStatus();
  const { setUserData, userData } = useUserData();
  const { setSelectedMenu, nextMenu, previousMenu } = useMenu();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalService, setModalService] = useState<ServiceId | null>(null);
  const [modalValues, setModalValues] = useState<Record<string, any>>({});
  const [isDragging, setIsDragging] = useState(false);

  if (!status) return null;

  // DND logic
  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      setUserData((prev) => {
        const services = prev.services ?? [];
        const oldIndex = services.findIndex((s) => s.id === active.id);
        const newIndex = services.findIndex((s) => s.id === over.id);
        const newServices = arrayMove(services, oldIndex, newIndex);
        return { ...prev, services: newServices };
      });
    }
    setIsDragging(false);
  }

  function handleDragStart(event: any) {
    setIsDragging(true);
  }

  // Modal handlers
  const handleServiceClick = (service: ServiceId) => {
    setModalService(service);
    const svc = userData.services?.find((s) => s.id === service);
    setModalValues(svc?.credentials || {});
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setModalService(null);
    setModalValues({});
  };

  const handleModalSubmit = (values: Record<string, any>) => {
    setUserData((prev) => {
      const newUserData = { ...prev };
      newUserData.services = (newUserData.services ?? []).map((service) => {
        if (service.id === modalService) {
          return {
            ...service,
            enabled: true,
            credentials: values,
          };
        }
        return service;
      });
      return newUserData;
    });
    handleModalClose();
  };

  const handleModalValuesChange = (newValues: Record<string, any>) => {
    setModalValues((prevValues) => ({
      ...prevValues,
      ...newValues,
    }));
  };

  useEffect(() => {
    const allServiceIds: ServiceId[] = Object.keys(
      status.settings.services
    ) as ServiceId[];
    const currentServices = userData.services ?? [];

    // Remove any services not in SERVICE_DETAILS and apply forced/default credentials
    let filtered = currentServices.filter((s) => allServiceIds.includes(s.id));

    // Add any missing services from SERVICE_DETAILS
    const missing = allServiceIds.filter(
      (id) => !filtered.some((s) => s.id === id)
    );

    if (missing.length > 0 || filtered.length !== currentServices.length) {
      const toAdd = missing.map((id) => {
        const svcMeta = status.settings.services[id]!;
        const credentials: Record<string, any> = {};
        let enabled = false;

        return {
          id,
          enabled,
          credentials,
        };
      });

      setUserData((prev: any) => ({
        ...prev,
        services: [...filtered, ...toAdd],
      }));
    }
  }, [status.settings.services, userData.services]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    })
  );

  useEffect(() => {
    function preventTouchMove(e: TouchEvent) {
      if (isDragging) {
        e.preventDefault();
      }
    }

    function handleDragEnd() {
      setIsDragging(false);
    }

    if (isDragging) {
      document.body.addEventListener('touchmove', preventTouchMove, {
        passive: false,
      });
      // Add listeners for when drag ends outside context
      document.addEventListener('pointerup', handleDragEnd);
      document.addEventListener('touchend', handleDragEnd);
    } else {
      document.body.removeEventListener('touchmove', preventTouchMove);
    }

    // Cleanup
    return () => {
      document.body.removeEventListener('touchmove', preventTouchMove);
      document.removeEventListener('pointerup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  const invalidServices =
    userData.services
      ?.filter((service) => {
        const svcMeta = status.settings.services[service.id];
        if (!svcMeta) return false;
        // Check if any required credential is missing
        return (
          service.enabled &&
          svcMeta.credentials.some(
            (cred) => !service.credentials?.[cred.id] && cred.required
          )
        );
      })
      .map((service) => status.settings.services[service.id]?.name) ?? [];

  // Render
  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Services</h2>
          <p className="text-[--muted]">
            Provide credentials for any services you want to use.
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>
      {invalidServices && invalidServices.length > 0 && (
        <div className="mb-6">
          <Alert
            intent="alert"
            title="Missing Credentials"
            description={
              <>
                The following services are missing credentials:
                <div className="flex flex-col gap-1 mt-2">
                  {invalidServices.map((service) => (
                    <div key={service} className="flex items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-current mr-2" />
                      {service}
                    </div>
                  ))}
                </div>
              </>
            }
          />
        </div>
      )}
      <div className="bg-[--card] border border-[--border] rounded-xl p-4 mb-6 shadow-sm">
        <DndContext
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <SortableContext
            items={userData.services?.map((s) => s.id) || []}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              <ul className="space-y-2">
                {(userData.services?.length ?? 0) === 0 ? (
                  <li>
                    <div className="flex flex-col items-center justify-center py-12">
                      <span className="text-lg text-muted-foreground font-semibold text-center">
                        Looks like you don't have any services configured.
                        <br />
                        Add and configure services above.
                      </span>
                    </div>
                  </li>
                ) : (
                  userData.services?.map((service, idx) => {
                    const svcMeta = status.settings.services[service.id] as
                      | StatusResponse['settings']['services'][ServiceId]
                      | undefined;
                    if (!svcMeta) return null;
                    return (
                      <SortableServiceItem
                        key={service.id}
                        service={service}
                        meta={svcMeta}
                        onEdit={() => handleServiceClick(service.id)}
                        onToggleEnabled={(v: boolean) => {
                          setUserData((prev) => {
                            return {
                              ...prev,
                              services: (prev.services ?? []).map((s) =>
                                s.id === service.id ? { ...s, enabled: v } : s
                              ),
                            };
                          });
                        }}
                      />
                    );
                  })
                )}
              </ul>
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <SettingsCard
        title="RPDB"
        description="Provide your RPDB API key if you want catalogs of supported types to use posters from RPDB"
      >
        <PasswordInput
          autoComplete="new-password"
          label="RPDB API Key"
          help={
            <span>
              Get your API Key from{' '}
              <a
                href="https://ratingposterdb.com/api-key/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                here
              </a>
            </span>
          }
          value={userData.rpdbApiKey}
          onValueChange={(v) => {
            setUserData((prev) => ({
              ...prev,
              rpdbApiKey: v,
            }));
          }}
        />

        <Switch
          label="Use Redirect API"
          side="right"
          disabled={!userData.rpdbApiKey || !status.settings.baseUrl}
          help={
            <span>
              If enabled, poster URLs will first contact AIOStreams and then be
              redirected to RPDB. This allows fallback posters to be used if the
              RPDB API is down or does not have a poster for that item. It can
              however cause a minimal slowdown due to having to contact
              AIOStreams first. This setting requires the <code>BASE_URL</code>{' '}
              environment variable to be set.
            </span>
          }
          value={
            userData.rpdbUseRedirectApi !== undefined
              ? userData.rpdbUseRedirectApi
              : !!status.settings.baseUrl
          }
          onValueChange={(v) => {
            setUserData((prev) => ({
              ...prev,
              rpdbUseRedirectApi: v,
            }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        title="TMDB"
        description={`Optionally provide your TMDB API Key and Read Access Token here. AIOStreams only needs one of them for title matching and its recommended and precaching to be able to
           determine when to move to the next season. Some addons in the marketplace will require one or the other too.`}
      >
        <PasswordInput
          label="TMDB Read Access Token"
          help={
            <>
              <p>
                You can get it from your{' '}
                <a
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  className="text-[--brand] hover:underline"
                  rel="noopener noreferrer"
                >
                  TMDB Account Settings.{' '}
                </a>
                Make sure to copy the Read Access Token and not the 32 character
                API Key.
              </p>
              <p></p>
            </>
          }
          required={!status?.settings.tmdbApiAvailable}
          value={userData.tmdbAccessToken}
          placeholder="Enter your TMDB access token"
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              tmdbAccessToken: value,
            }));
          }}
        />

        <PasswordInput
          label="TMDB API Key"
          help={
            <span>
              You can get it from your{' '}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                TMDB Account Settings.{' '}
              </a>
              Make sure to copy the 32 character API Key and not the Read Access
              Token.
            </span>
          }
          placeholder="Enter your TMDB API Key"
          value={userData.tmdbApiKey}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              tmdbApiKey: value,
            }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        title="TVDB"
        description="Provide your TVDB API key to also fetch metadata from TVDB."
      >
        <PasswordInput
          label="TVDB API Key"
          value={userData.tvdbApiKey}
          placeholder="Enter your TVDB API Key"
          help={
            <span>
              Sign up for a <b>free</b> API Key at{' '}
              <a
                href="https://www.thetvdb.com/api-information"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                TVDB.{' '}
              </a>
            </span>
          }
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              tvdbApiKey: value,
            }));
          }}
        />
      </SettingsCard>

      <ServiceModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        serviceId={modalService}
        values={modalValues}
        onSubmit={handleModalSubmit}
        onClose={handleModalClose}
      />
    </>
  );
}

function SortableServiceItem({
  service,
  meta,
  onEdit,
  onToggleEnabled,
}: {
  service: Exclude<UserData['services'], undefined>[number];
  meta: Exclude<StatusResponse['settings']['services'][ServiceId], undefined>;
  onEdit: () => void;
  onToggleEnabled: (v: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const disableEdit = meta.credentials.every((cred) => {
    return cred.forced;
  });
  const expiry = useServiceExpiry({
    serviceId: service.id,
    serviceName: meta?.name || service.id,
    credentials: service.credentials,
  });
  const serviceTitle =
    expiry.status === 'error'
      ? `${meta?.name || service.id}: ${expiry.error}`
      : expiry.status === 'disabled'
        ? `${meta?.name || service.id}: Expiry badge hidden`
        : undefined;
  return (
    <li ref={setNodeRef} style={style}>
      <div className="px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border flex gap-3 relative">
        <div
          className="rounded-full w-6 h-auto bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move"
          {...attributes}
          {...listeners}
        />
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-base truncate" title={serviceTitle}>
              {meta?.name || service.id}
            </span>
            {expiry.status === 'success' &&
              expiry.badgeText &&
              expiry.badgeColors && (
                <ServiceExpiryBadge
                  text={expiry.badgeText}
                  colors={expiry.badgeColors}
                  title={expiry.tooltip}
                />
              )}
          </div>
          <span className="text-sm text-[--muted] font-normal italic break-words">
            <MarkdownLite>{meta?.signUpText}</MarkdownLite>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            value={!!service.enabled}
            onValueChange={onToggleEnabled}
            disabled={disableEdit}
          />
          <IconButton
            icon={<FiSettings />}
            intent="primary-outline"
            onClick={onEdit}
            disabled={disableEdit}
          />
        </div>
      </div>
    </li>
  );
}
function ServiceModal({
  open,
  onOpenChange,
  serviceId,
  values,
  onSubmit,
  onClose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serviceId: ServiceId | null;
  values: Record<string, any>;
  onSubmit: (v: Record<string, any>) => void;
  onClose: () => void;
}) {
  const { status } = useStatus();
  const [localValues, setLocalValues] = useState<Record<string, any>>({});
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('auto');
  const [manualExpiryInput, setManualExpiryInput] = useState('');
  const [manualExpiryUpdatedAt, setManualExpiryUpdatedAt] = useState<
    number | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setLocalValues(values);
    if (!serviceId) {
      setExpiryMode('auto');
      setManualExpiryInput('');
      setManualExpiryUpdatedAt(null);
      return;
    }
    const preference = getExpiryPreference(serviceId);
    const supportsAuto = canServiceAutoFetch(serviceId);
    const resolvedMode =
      preference.mode === 'auto' && !supportsAuto ? 'manual' : preference.mode;
    setExpiryMode(resolvedMode);
    setManualExpiryInput(preference.date ?? '');
    setManualExpiryUpdatedAt(preference.updatedAt ?? null);
  }, [open, serviceId, values]);

  if (!status) return null;
  if (!serviceId) return null;
  const meta = status.settings.services[serviceId]!;
  const credentials = meta.credentials || [];
  const allowExpiryControls = isTrackedService(serviceId);
  const autoSupported = canServiceAutoFetch(serviceId);

  const handleCredentialChange = (optId: string, newValue: any) => {
    setLocalValues((prev) => ({
      ...prev,
      [optId]: newValue,
    }));
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Configure ${meta.name}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (allowExpiryControls) {
            const trimmed = manualExpiryInput.trim();
            if (expiryMode === 'auto') {
              setExpiryPreference(serviceId, null);
            } else if (expiryMode === 'hidden') {
              setExpiryPreference(serviceId, { mode: 'hidden' });
            } else {
              setExpiryPreference(serviceId, {
                mode: 'manual',
                date: trimmed ? trimmed : undefined,
              });
              setManualExpiryUpdatedAt(trimmed ? Date.now() : null);
            }
          }
          onSubmit(localValues);
        }}
      >
        {credentials.map((opt) => (
          <TemplateOption
            key={opt.id}
            option={{
              ...opt,
              required: false, // override required to false to allow unsetting
            }}
            value={opt.forced || opt.default || localValues[opt.id]}
            onChange={(v) => handleCredentialChange(opt.id, v || undefined)}
          />
        ))}
        {allowExpiryControls && (
          <div className="space-y-2">
            <Select
              label="Expiry Badge Mode"
              value={expiryMode}
              onValueChange={(mode) =>
                setExpiryMode((mode as ExpiryMode) || 'auto')
              }
              options={[
                {
                  value: 'auto',
                  label: 'Auto fetch from provider',
                  disabled: !autoSupported,
                },
                { value: 'manual', label: 'Manual date' },
                { value: 'hidden', label: 'Hide badge' },
              ]}
            />
            {expiryMode === 'manual' && (
              <div className="space-y-2">
                <TextInput
                  label="Manual Expiry Date"
                  placeholder="YYYY-MM-DD"
                  value={manualExpiryInput}
                  onValueChange={setManualExpiryInput}
                  inputMode="text"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <ServiceExpiryDatePicker
                    value={manualExpiryInput}
                    onSelect={setManualExpiryInput}
                    onClear={() => setManualExpiryInput('')}
                  />
                  <Button
                    type="button"
                    size="sm"
                    intent="gray-outline"
                    onClick={() => setManualExpiryInput('')}
                    disabled={!manualExpiryInput}
                  >
                    Clear Date
                  </Button>
                </div>
                <p className="text-xs text-[--muted]">
                  {manualExpiryUpdatedAt
                    ? `Last saved ${new Date(
                        manualExpiryUpdatedAt
                      ).toLocaleString()}.`
                    : 'Pick a date or type it above to show the badge.'}
                </p>
              </div>
            )}
            <p className="text-xs text-[--muted]">
              {autoSupported
                ? 'Auto fetch uses your service credentials to refresh the badge. Manual mode lets you control the date yourself, while Hide turns the badge off.'
                : 'This service cannot fetch expiry automatically. Use Manual to enter a date or choose Hide to remove the badge.'}
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            className="w-full"
            intent="primary-outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" className="w-full">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
