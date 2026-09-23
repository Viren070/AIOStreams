import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { CatalogModification } from '@aiostreams/core';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { IconButton } from '../../../ui/button';
import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { MdRefresh } from 'react-icons/md';
import {
  SortableCatalogItem,
  type CatalogUpdate,
} from './sortable-catalog-item';

const MODIFIERS = [restrictToVerticalAxis];

const catalogKey = (c: CatalogModification) => `${c.id}-${c.type}`;

export function CatalogSettingsCard({
  loading,
  fetchCatalogsData,
}: {
  loading: boolean;
  fetchCatalogsData: (hideToast?: boolean) => void | Promise<void>;
}) {
  const { userData, setUserData } = useUserData();

  const mergedCatalogsCountRef = useRef(userData.mergedCatalogs?.length ?? 0);
  useEffect(() => {
    const currentCount = userData.mergedCatalogs?.length ?? 0;
    if (currentCount !== mergedCatalogsCountRef.current) {
      mergedCatalogsCountRef.current = currentCount;
      fetchCatalogsData(true);
    }
  }, [userData.mergedCatalogs?.length, fetchCatalogsData]);

  const sourceCatalogsInMergedCatalogs = useMemo(() => {
    const set = new Set<string>();
    const enabledMerged = (userData.mergedCatalogs || []).filter(
      (mc) => mc.enabled !== false
    );
    for (const mc of enabledMerged) {
      for (const encodedId of mc.catalogIds) {
        const params = new URLSearchParams(encodedId);
        const id = params.get('id');
        const type = params.get('type');
        if (id && type) {
          set.add(`${id}-${type}`);
        }
      }
    }
    return set;
  }, [userData.mergedCatalogs]);

  const visibleCatalogs = useMemo(
    () =>
      (userData.catalogModifications ?? []).filter(
        (catalog) => !sourceCatalogsInMergedCatalogs.has(catalogKey(catalog))
      ),
    [userData.catalogModifications, sourceCatalogsInMergedCatalogs]
  );
  // dnd-kit re-renders every sortable row when this array's identity changes
  const sortableIds = useMemo(
    () => visibleCatalogs.map(catalogKey),
    [visibleCatalogs]
  );

  const updateCatalog = useCallback(
    (id: string, type: string, update: CatalogUpdate) => {
      setUserData((prev) => ({
        ...prev,
        catalogModifications: prev.catalogModifications?.map((c) =>
          c.id === id && c.type === type ? update(c) : c
        ),
      }));
    },
    [setUserData]
  );

  const moveCatalog = useCallback(
    (id: string, type: string, to: 'top' | 'bottom') => {
      setUserData((prev) => {
        if (!prev.catalogModifications) return prev;
        const index = prev.catalogModifications.findIndex(
          (c) => c.id === id && c.type === type
        );
        const last = prev.catalogModifications.length - 1;
        if (index < 0 || index === (to === 'top' ? 0 : last)) return prev;
        const newMods = [...prev.catalogModifications];
        const [item] = newMods.splice(index, 1);
        if (to === 'top') newMods.unshift(item);
        else newMods.push(item);
        return { ...prev, catalogModifications: newMods };
      });
    },
    [setUserData]
  );

  const toggleCatalog = useCallback(
    (id: string, type: string, enabled: boolean) => {
      setUserData((prev) => ({
        ...prev,
        catalogModifications: prev.catalogModifications?.map((c) =>
          c.id === id && c.type === type ? { ...c, enabled } : c
        ),
        ...(id.startsWith('aiostreams.merged.') && {
          mergedCatalogs: prev.mergedCatalogs?.map((mc) =>
            mc.id === id ? { ...mc, enabled } : mc
          ),
        }),
      }));
    },
    [setUserData]
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    })
  );

  const [isDragging, setIsDragging] = useState(false);

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
      document.addEventListener('pointerup', handleDragEnd);
      document.addEventListener('touchend', handleDragEnd);
    } else {
      document.body.removeEventListener('touchmove', preventTouchMove);
    }
    return () => {
      document.body.removeEventListener('touchmove', preventTouchMove);
      document.removeEventListener('pointerup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      setUserData((prev) => {
        const oldIndex = prev.catalogModifications?.findIndex(
          (c) => `${c.id}-${c.type}` === active.id
        );
        const newIndex = prev.catalogModifications?.findIndex(
          (c) => `${c.id}-${c.type}` === over.id
        );
        if (
          oldIndex === undefined ||
          newIndex === undefined ||
          !prev.catalogModifications
        )
          return prev;
        return {
          ...prev,
          catalogModifications: arrayMove(
            prev.catalogModifications,
            oldIndex,
            newIndex
          ),
        };
      });
    }
    setIsDragging(false);
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  return (
    <SettingsCard
      title="Catalogs"
      id="catalogs"
      description="Rename, reorder, and toggle your catalogs, and apply modifications like RPDB posters and shuffling. Adjusting catalogs may require a reinstall - if it does, a pop-up will tell you."
      action={
        <IconButton
          size="sm"
          intent="warning-subtle"
          icon={<MdRefresh />}
          rounded
          onClick={() => {
            fetchCatalogsData();
          }}
          loading={loading}
        />
      }
    >
      {!userData.catalogModifications?.length && (
        <p className="text-[--muted] text-base text-center my-8">
          Your addons don't have any catalogs... or you haven't fetched them yet
          :/
        </p>
      )}
      {visibleCatalogs.length > 0 && (
        <DndContext
          modifiers={MODIFIERS}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {visibleCatalogs.map((catalog) => (
                <SortableCatalogItem
                  key={catalogKey(catalog)}
                  catalog={catalog}
                  onUpdate={updateCatalog}
                  onMove={moveCatalog}
                  onToggleEnabled={toggleCatalog}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </SettingsCard>
  );
}
