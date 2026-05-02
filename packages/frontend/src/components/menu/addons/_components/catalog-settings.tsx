'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { SortableCatalogItem } from './sortable-catalog-item';

export function CatalogSettingsCard({
  loading,
  fetchCatalogsData,
}: {
  loading: boolean;
  fetchCatalogsData: (hideToast?: boolean) => Promise<void>;
}) {
  const { userData, setUserData } = useUserData();

  const mergedCatalogsCountRef = useRef(userData.mergedCatalogs?.length ?? 0);
  useEffect(() => {
    const currentCount = userData.mergedCatalogs?.length ?? 0;
    if (currentCount !== mergedCatalogsCountRef.current) {
      mergedCatalogsCountRef.current = currentCount;
      // Trigger refresh when merged catalog count changes (added or deleted)
      fetchCatalogsData(true);
    }
  }, [userData.mergedCatalogs?.length, fetchCatalogsData]);

  const capitalise = (str: string | undefined) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  // Build set of source catalog IDs that are part of enabled merged catalogs
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

  // DND handlers
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
      {userData.catalogModifications &&
        userData.catalogModifications.length > 0 && (
          <DndContext
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            sensors={sensors}
          >
            <SortableContext
              items={(userData.catalogModifications || []).map(
                (c) => `${c.id}-${c.type}`
              )}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {(userData.catalogModifications || [])
                  .filter(
                    (catalog) =>
                      !sourceCatalogsInMergedCatalogs.has(
                        `${catalog.id}-${catalog.type}`
                      )
                  )
                  .map((catalog: CatalogModification) => (
                    <SortableCatalogItem
                      key={`${catalog.id}-${catalog.type}`}
                      catalog={catalog}
                      onToggleEnabled={(enabled) => {
                        setUserData((prev) => {
                          const newState: Partial<typeof prev> = {
                            catalogModifications:
                              prev.catalogModifications?.map((c) =>
                                c.id === catalog.id && c.type === catalog.type
                                  ? { ...c, enabled }
                                  : c
                              ),
                          };
                          // If this is a merged catalog, also update mergedCatalogs state
                          if (catalog.id.startsWith('aiostreams.merged.')) {
                            newState.mergedCatalogs = prev.mergedCatalogs?.map(
                              (mc) =>
                                mc.id === catalog.id ? { ...mc, enabled } : mc
                            );
                          }
                          return { ...prev, ...newState };
                        });
                      }}
                      capitalise={capitalise}
                    />
                  ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
    </SettingsCard>
  );
}
