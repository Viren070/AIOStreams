import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { useState, useEffect } from 'react';
import { ServiceId } from '../../../../../../core/src/utils/constants';
import { isDualService, isUsenetService } from '@/lib/services';
import { ServiceLogo } from '../../../shared/service-logo';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DndContext,
  useSensors,
  PointerSensor,
  TouchSensor,
  useSensor,
} from '@dnd-kit/core';
import { Button, IconButton } from '../../../ui/button';
import { FiSettings, FiSearch } from 'react-icons/fi';
import { TextInput } from '../../../ui/text-input';
import { cn } from '../../../ui/core/styling';
import { Switch } from '../../../ui/switch';
import { Modal } from '../../../ui/modal';
import { Alert } from '../../../ui/alert';
import TemplateOption from '../../../shared/template-option';
import MarkdownLite from '../../../shared/markdown-lite';
import { StatusResponse, UserData } from '@aiostreams/core';

export function StreamServices() {
  const { status } = useStatus();
  if (!status) return null;
  const { setUserData, userData } = useUserData();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalService, setModalService] = useState<ServiceId | null>(null);
  const [modalValues, setModalValues] = useState<Record<string, any>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | 'debrid' | 'usenet'
  >('all');

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

  function handleDragStart() {
    setIsDragging(true);
  }

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
          return { ...service, enabled: true, credentials: values };
        }
        return service;
      });
      return newUserData;
    });
    handleModalClose();
  };

  useEffect(() => {
    const allServiceIds: ServiceId[] = Object.keys(
      status.settings.services
    ) as ServiceId[];
    const currentServices = userData.services ?? [];
    let filtered = currentServices.filter((s) => allServiceIds.includes(s.id));
    const missing = allServiceIds.filter(
      (id) => !filtered.some((s) => s.id === id)
    );
    if (missing.length > 0 || filtered.length !== currentServices.length) {
      const toAdd = missing.map((id) => ({
        id,
        enabled: false,
        credentials: {},
      }));
      setUserData((prev: any) => ({
        ...prev,
        services: [...filtered, ...toAdd],
      }));
    }
  }, [status.settings.services, userData.services]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    })
  );

  useEffect(() => {
    function preventTouchMove(e: TouchEvent) {
      if (isDragging) e.preventDefault();
    }
    function handleDragEndDoc() {
      setIsDragging(false);
    }
    if (isDragging) {
      document.body.addEventListener('touchmove', preventTouchMove, {
        passive: false,
      });
      document.addEventListener('pointerup', handleDragEndDoc);
      document.addEventListener('touchend', handleDragEndDoc);
    } else {
      document.body.removeEventListener('touchmove', preventTouchMove);
    }
    return () => {
      document.body.removeEventListener('touchmove', preventTouchMove);
      document.removeEventListener('pointerup', handleDragEndDoc);
      document.removeEventListener('touchend', handleDragEndDoc);
    };
  }, [isDragging]);

  const invalidServices =
    userData.services
      ?.filter((service) => {
        const svcMeta = status.settings.services[service.id];
        if (!svcMeta) return false;
        return (
          service.enabled &&
          svcMeta.credentials.some(
            (cred) => !service.credentials?.[cred.id] && cred.required
          )
        );
      })
      .map((service) => status.settings.services[service.id]?.name) ?? [];

  const allServiceIds = userData.services?.map((s) => s.id) || [];

  const isFiltering = searchQuery.trim() !== '' || categoryFilter !== 'all';

  const filteredServices = (userData.services ?? []).filter((service) => {
    const svcMeta = status.settings.services[service.id];
    if (!svcMeta) return false;
    if (categoryFilter !== 'all') {
      const dual = isDualService(service.id);
      const usenet = isUsenetService(service.id);
      if (!dual) {
        if (categoryFilter === 'debrid' && usenet) return false;
        if (categoryFilter === 'usenet' && !usenet) return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = (svcMeta.name ?? '').toLowerCase();
      const shortName = (svcMeta.shortName ?? '').toLowerCase();
      if (!name.includes(q) && !shortName.includes(q)) return false;
    }
    return true;
  });

  return (
    <>
      {invalidServices.length > 0 && (
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
      )}

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <TextInput
          className="flex-1 w-full sm:w-auto"
          placeholder="Search services..."
          leftIcon={<FiSearch className="w-4 h-4 text-[--muted]" />}
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <div className="flex gap-1.5 shrink-0">
          {(['all', 'debrid', 'usenet'] as const).map((cat) => {
            const activeClass =
              cat === 'debrid'
                ? 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700'
                : cat === 'usenet'
                  ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-500/40 dark:text-blue-300 dark:border-blue-500'
                  : 'bg-[--subtle-highlight] text-[--foreground] border-[--border]';
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors capitalize',
                  categoryFilter === cat
                    ? activeClass
                    : 'border-[--border] text-[--muted] hover:bg-[--subtle]'
                )}
              >
                {cat === 'all'
                  ? 'All'
                  : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {isFiltering ? (
        <p className="text-sm text-[--muted]">
          Showing {filteredServices.length} of {userData.services?.length ?? 0}{' '}
          services.{' '}
          <button
            type="button"
            className="underline hover:text-[--foreground] transition-colors"
            onClick={() => {
              setSearchQuery('');
              setCategoryFilter('all');
            }}
          >
            Clear filters
          </button>{' '}
          to reorder.
        </p>
      ) : (
        <p className="text-sm text-[--muted]">
          Drag to reorder by priority. Enable a service and click{' '}
          <strong>Configure</strong> to enter credentials.
        </p>
      )}

      {isFiltering ? (
        <ul className="space-y-2">
          {filteredServices.length === 0 ? (
            <li>
              <div className="flex flex-col items-center justify-center py-12">
                <span className="text-lg text-[--muted] font-semibold text-center">
                  No services match your search.
                </span>
              </div>
            </li>
          ) : (
            filteredServices.map((service) => {
              const svcMeta = status.settings.services[service.id] as
                | StatusResponse['settings']['services'][ServiceId]
                | undefined;
              if (!svcMeta) return null;
              return (
                <PlainServiceItem
                  key={service.id}
                  service={service}
                  meta={svcMeta}
                  onEdit={() => handleServiceClick(service.id)}
                  onToggleEnabled={(v: boolean) => {
                    setUserData((prev) => ({
                      ...prev,
                      services: (prev.services ?? []).map((s) =>
                        s.id === service.id ? { ...s, enabled: v } : s
                      ),
                    }));
                  }}
                />
              );
            })
          )}
        </ul>
      ) : (
        <DndContext
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <SortableContext
            items={allServiceIds}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {(userData.services?.length ?? 0) === 0 ? (
                <li>
                  <div className="flex flex-col items-center justify-center py-12">
                    <span className="text-lg text-[--muted] font-semibold text-center">
                      No services found.
                    </span>
                  </div>
                </li>
              ) : (
                userData.services?.map((service) => {
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
                        setUserData((prev) => ({
                          ...prev,
                          services: (prev.services ?? []).map((s) =>
                            s.id === service.id ? { ...s, enabled: v } : s
                          ),
                        }));
                      }}
                    />
                  );
                })
              )}
            </ul>
          </SortableContext>
        </DndContext>
      )}

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

type ServiceItemProps = {
  service: Exclude<UserData['services'], undefined>[number];
  meta: Exclude<StatusResponse['settings']['services'][ServiceId], undefined>;
  onEdit: () => void;
  onToggleEnabled: (v: boolean) => void;
  dragHandleProps?: { attributes: any; listeners: any } | null;
};

function ServiceItemRow({
  service,
  meta,
  onEdit,
  onToggleEnabled,
  dragHandleProps,
}: ServiceItemProps) {
  const disableEdit = meta.credentials.every((cred) => cred.forced);
  const usenet = isUsenetService(service.id);
  const dual = isDualService(service.id);

  return (
    <div className="px-3 py-2.5 bg-[var(--background)] rounded-[--radius-md] border flex gap-3 items-center relative">
      {dragHandleProps ? (
        <div
          className="rounded-full w-6 h-auto self-stretch flex-shrink-0 bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move"
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
        />
      ) : (
        <div className="w-6 flex-shrink-0" />
      )}
      <ServiceLogo serviceId={service.id} shortName={meta.shortName} />
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm truncate">
            {meta?.name || service.id}
          </span>
          {dual ? (
            <>
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                Debrid
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-500/30 dark:text-blue-400">
                Usenet
              </span>
            </>
          ) : usenet ? (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-500/30 dark:text-blue-400">
              Usenet
            </span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              Debrid
            </span>
          )}
        </div>
        <span className="text-xs text-[--muted] font-normal line-clamp-1">
          <MarkdownLite>{meta?.signUpText}</MarkdownLite>
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          value={!!service.enabled}
          onValueChange={onToggleEnabled}
          disabled={disableEdit}
        />
        <IconButton
          intent="gray-outline"
          size="sm"
          onClick={onEdit}
          disabled={disableEdit}
          icon={<FiSettings />}
        />
      </div>
    </div>
  );
}

function PlainServiceItem({
  service,
  meta,
  onEdit,
  onToggleEnabled,
}: Omit<ServiceItemProps, 'dragHandleProps'>) {
  return (
    <li>
      <ServiceItemRow
        service={service}
        meta={meta}
        onEdit={onEdit}
        onToggleEnabled={onToggleEnabled}
        dragHandleProps={null}
      />
    </li>
  );
}

function SortableServiceItem({
  service,
  meta,
  onEdit,
  onToggleEnabled,
}: Omit<ServiceItemProps, 'dragHandleProps'>) {
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

  return (
    <li ref={setNodeRef} style={style}>
      <ServiceItemRow
        service={service}
        meta={meta}
        onEdit={onEdit}
        onToggleEnabled={onToggleEnabled}
        dragHandleProps={{ attributes, listeners }}
      />
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

  useEffect(() => {
    if (open) setLocalValues(values);
  }, [open, values]);

  if (!status || !serviceId) return null;
  const meta = status.settings.services[serviceId]!;
  const credentials = meta.credentials || [];

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
          onSubmit(localValues);
        }}
      >
        {credentials.map((opt) => (
          <TemplateOption
            key={opt.id}
            option={{ ...opt, required: false }}
            value={opt.forced || opt.default || localValues[opt.id]}
            onChange={(v) =>
              setLocalValues((prev) => ({ ...prev, [opt.id]: v || undefined }))
            }
          />
        ))}
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
