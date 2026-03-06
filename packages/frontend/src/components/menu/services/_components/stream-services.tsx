'use client';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { useState, useEffect } from 'react';
import {
  ServiceId,
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
  EASYNEWS_SERVICE,
  STREMTHRU_NEWZ_SERVICE,
} from '../../../../../../core/src/utils/constants';
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

// Usenet service IDs
const USENET_SERVICE_IDS: string[] = [
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
  EASYNEWS_SERVICE,
  STREMTHRU_NEWZ_SERVICE,
];

const DUAL_SERVICE_IDS: string[] = ['torbox'];

function isUsenetService(id: string): boolean {
  return USENET_SERVICE_IDS.includes(id);
}

function isDualService(id: string): boolean {
  return DUAL_SERVICE_IDS.includes(id);
}
/**
 * <svg data-v-8e64e47b="" data-v-54780de2="" class="logo-svg" fill="none" xmlns="http://www.w3.org/2000/svg"><path data-v-8e64e47b="" fill="var(--color-primary)" clip-rule="evenodd" d="M26.5835 15.2408C27.0625 15.1802 27.4695 14.8617 27.6434 14.4113L29.0836 10.6824C29.2028 10.3737 28.9496 10.0495 28.6213 10.0904L13.4653 11.9768C12.6864 12.0738 12.0192 12.5804 11.7165 13.3045L10.032 17.3354L16.8876 16.4679L26.5835 15.2408ZM33.4485 15.2408C32.9695 15.1802 32.5625 14.8617 32.3885 14.4113L30.9484 10.6824C30.8292 10.3737 31.0824 10.0495 31.4107 10.0904L46.5667 11.9768C47.3455 12.0738 48.0128 12.5804 48.3154 13.3045L50 17.3354L33.4485 15.2408ZM10 17.336H50V39.3048C50 41.7755 47.9971 43.7784 45.5263 43.7784H14.4737C12.0029 43.7784 10 41.7755 10 39.3048V17.336ZM22.889 24.2091C23.8772 24.2091 24.6784 25.0102 24.6784 25.9985V29.5541C24.6784 30.5424 23.8772 31.3435 22.889 31.3435C21.9007 31.3435 21.0995 30.5424 21.0995 29.5541V25.9985C21.0995 25.0102 21.9007 24.2091 22.889 24.2091ZM38.9006 25.9985C38.9006 25.0102 38.0994 24.2091 37.1111 24.2091C36.1228 24.2091 35.3217 25.0102 35.3217 25.9985V29.5541C35.3217 30.5424 36.1228 31.3435 37.1111 31.3435C38.0994 31.3435 38.9006 30.5424 38.9006 29.5541V25.9985ZM35.4241 36.7358C35.6534 37.314 35.3706 37.9687 34.7924 38.198L34.615 37.7507C34.6956 37.954 34.7923 38.1981 34.792 38.1982L34.7906 38.1987L34.788 38.1998L34.7803 38.2028L34.7552 38.2125C34.7343 38.2205 34.705 38.2316 34.668 38.2454C34.5939 38.2728 34.4885 38.3108 34.3562 38.3558C34.0921 38.4457 33.7183 38.5645 33.2711 38.683C32.3873 38.9173 31.1692 39.1638 29.9243 39.1638C28.6786 39.1638 27.4701 38.9171 26.5947 38.6821C26.152 38.5633 25.7828 38.4443 25.522 38.354C25.3913 38.3089 25.2872 38.2707 25.2141 38.2431C25.1774 38.2293 25.1485 38.2181 25.1278 38.21L25.1029 38.2002L25.0952 38.1971L25.0925 38.1961L25.0911 38.1955C25.0908 38.1954 25.3266 37.6115 25.3889 37.4575L25.0907 38.1953C24.514 37.9623 24.2354 37.3058 24.4685 36.7291C24.7014 36.1528 25.3571 35.8742 25.9335 36.1063L25.9352 36.107L25.948 36.1121C25.9605 36.1169 25.9808 36.1248 26.0085 36.1353C26.064 36.1561 26.1486 36.1872 26.2582 36.2252C26.478 36.3011 26.7958 36.4037 27.1787 36.5065C27.9545 36.7148 28.9518 36.9112 29.9243 36.9112C30.8975 36.9112 31.9059 36.7145 32.6939 36.5056C33.0826 36.4026 33.4062 36.2997 33.6304 36.2234C33.7423 36.1853 33.8288 36.154 33.8856 36.133C33.9139 36.1225 33.9349 36.1145 33.9478 36.1096L33.961 36.1045L33.9618 36.1041L33.9622 36.104L33.9624 36.1039L33.9628 36.1038C34.5408 35.8752 35.1949 36.158 35.4241 36.7358Z" fill-rule="evenodd"></path><path data-v-8e64e47b="" class="logo-text" clip-rule="evenodd" d="M80.4649 22.36C79.9222 22.36 79.4675 22.1913 79.1009 21.854C78.7489 21.502 78.5729 21.0693 78.5729 20.556C78.5729 20.0426 78.7489 19.6173 79.1009 19.28C79.4675 18.928 79.9222 18.752 80.4649 18.752C81.0075 18.752 81.4549 18.928 81.8069 19.28C82.1735 19.6173 82.3569 20.0426 82.3569 20.556C82.3569 21.0693 82.1735 21.502 81.8069 21.854C81.4549 22.1913 81.0075 22.36 80.4649 22.36ZM81.9829 23.812V36H78.9029V23.812H81.9829ZM88.1059 30.8077L92.2419 35.9997H96.2459L90.8339 29.9277L96.2019 23.8117H92.1979L88.1059 28.9817V19.7197H85.0259V35.9997H88.1059V30.8077ZM129.248 30.8077L133.384 35.9997H137.388L131.976 29.9277L137.344 23.8117H133.34L129.248 28.9817V19.7197H126.168V35.9997H129.248V30.8077ZM111.192 26.5843C110.708 27.5376 110.466 28.6303 110.466 29.8623C110.466 31.1089 110.708 32.2163 111.192 33.1843C111.691 34.1376 112.358 34.8783 113.194 35.4063C114.045 35.9343 114.984 36.1983 116.01 36.1983C116.92 36.1983 117.719 36.0149 118.408 35.6483C119.112 35.2669 119.662 34.7903 120.058 34.2183V36.0003H123.16V23.8123H120.058V25.5503C119.648 24.9929 119.098 24.5309 118.408 24.1643C117.734 23.7976 116.942 23.6143 116.032 23.6143C114.991 23.6143 114.045 23.8709 113.194 24.3843C112.358 24.8976 111.691 25.6309 111.192 26.5843ZM119.618 27.9923C119.912 28.5203 120.058 29.1583 120.058 29.9063C120.058 30.6543 119.912 31.2996 119.618 31.8423C119.325 32.3703 118.929 32.7809 118.43 33.0743C117.932 33.3529 117.396 33.4923 116.824 33.4923C116.267 33.4923 115.739 33.3456 115.24 33.0523C114.756 32.7589 114.36 32.3409 114.052 31.7983C113.759 31.2409 113.612 30.5956 113.612 29.8623C113.612 29.1289 113.759 28.4983 114.052 27.9703C114.36 27.4276 114.756 27.0169 115.24 26.7383C115.724 26.4596 116.252 26.3203 116.824 26.3203C117.396 26.3203 117.932 26.4669 118.43 26.7603C118.929 27.0389 119.325 27.4496 119.618 27.9923ZM109.072 25.3956C109.072 26.2169 108.874 26.9869 108.478 27.7056C108.096 28.4242 107.488 29.0036 106.652 29.4436C105.83 29.8836 104.789 30.1036 103.528 30.1036H100.954V35.9996H97.8735V20.6436H103.528C104.716 20.6436 105.728 20.8489 106.564 21.2596C107.4 21.6702 108.023 22.2349 108.434 22.9536C108.859 23.6722 109.072 24.4862 109.072 25.3956ZM103.396 27.6176C104.246 27.6176 104.877 27.4269 105.288 27.0456C105.698 26.6496 105.904 26.0996 105.904 25.3956C105.904 23.8996 105.068 23.1516 103.396 23.1516H100.954V27.6176H103.396ZM76.1221 27.7056C76.5181 26.9869 76.7161 26.2169 76.7161 25.3956C76.7161 24.4862 76.5034 23.6722 76.0781 22.9536C75.6674 22.2349 75.0441 21.6702 74.2081 21.2596C73.3721 20.8489 72.3601 20.6436 71.1721 20.6436H65.5181V35.9996H68.5981V30.1036H71.1721C72.4334 30.1036 73.4747 29.8836 74.2961 29.4436C75.1321 29.0036 75.7407 28.4242 76.1221 27.7056ZM72.9321 27.0456C72.5214 27.4269 71.8907 27.6176 71.0401 27.6176H68.5981V23.1516H71.0401C72.7121 23.1516 73.5481 23.8996 73.5481 25.3956C73.5481 26.0996 73.3427 26.6496 72.9321 27.0456Z" fill="black" fill-rule="evenodd"></path></svg>
 */
const SERVICE_LOGO_MAP: Record<ServiceId, string> = {
  realdebrid: 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/real-debrid.png',
  debridlink: 'https://debrid-link.com/img/brand/dl-white-blue.svg',
  premiumize: 'https://www.premiumize.me/icon_normal.svg',
  alldebrid: 'https://cdn.alldebrid.com/lib/images/default/logo_alldebrid.png',
  torbox: 'https://torbox.app/assets/logo-bb7a9579.svg',
  putio:
    'https://images.seeklogo.com/logo-png/51/1/put-io-logo-png_seeklogo-516681.png',
  pikpak: 'https://mypikpak.com/apple-touch-icon.png',
  offcloud: 'https://offcloud.com/images/logo-blue-short-lg.png',
  seedr: 'https://static.seedr.cc/images/seed_v2.png',
  easydebrid: 'https://paradise-cloud.com/apple-touch-icon.png',
  debrider: 'https://debrider.app/icon.svg',
  easynews: '/assets/easynews_logo.png',
  stremthru_newz: 'https://emojiapi.dev/api/v1/sparkles/256.png',
  stremio_nntp:
    'https://raw.githubusercontent.com/Stremio/stremio-brand/refs/heads/master/logos/PNG/stremio-logo-800px.png',
  nzbdav:
    'https://raw.githubusercontent.com/nzbdav-dev/nzbdav/refs/heads/main/frontend/public/logo.svg',
  altmount:
    'https://raw.githubusercontent.com/javi11/altmount/refs/heads/main/docs/static/img/logo.png',
};

function ServiceLogo({
  serviceId,
  shortName,
}: {
  serviceId: ServiceId;
  shortName: string;
}) {
  const logoUrl = SERVICE_LOGO_MAP[serviceId];

  if (!logoUrl) {
    return (
      <div className="w-9 h-9 rounded-lg bg-[--subtle] border border-[--border] flex items-center justify-center text-xs font-bold font-mono shrink-0 text-[--muted]">
        {shortName}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={shortName}
      className="w-9 h-9 rounded-lg object-contain shrink-0"
    />
  );
}

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
                  ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700'
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
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                Usenet
              </span>
            </>
          ) : usenet ? (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
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
