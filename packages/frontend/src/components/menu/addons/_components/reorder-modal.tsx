'use client';
import React, { useState, useEffect } from 'react';
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
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { IoExtensionPuzzle } from 'react-icons/io5';
import Image from 'next/image';
import { PlusIcon } from 'lucide-react';

interface ReorderItem {
  instanceId: string;
  name: string;
  type: string;
  logo?: string;
  enabled: boolean;
}

function SortableReorderItem({ item }: { item: ReorderItem }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.instanceId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 0,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border bg-[var(--background)] select-none ${
        isDragging ? 'shadow-lg border-[--brand]/50' : 'border-[--border]'
      } ${!item.enabled ? 'opacity-50' : ''}`}
      {...attributes}
    >
      <div
        className="flex items-center justify-center w-5 text-sm font-mono text-[--muted] flex-shrink-0 cursor-move touch-none"
        {...listeners}
      >
        <svg
          className="w-4 h-4 text-[--muted]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M4 8h16M4 16h16" strokeLinecap="round" />
        </svg>
      </div>
      <div className="relative flex-shrink-0 h-6 w-6">
        {item.logo ? (
          <Image
            src={item.logo}
            alt={item.name}
            fill
            className="w-full h-full object-contain rounded"
          />
        ) : item.type === 'custom' ? (
          <PlusIcon className="w-full h-full text-[--brand]" />
        ) : (
          <IoExtensionPuzzle className="w-full h-full text-[--brand]" />
        )}
      </div>
      <span className="text-sm font-medium truncate flex-1">{item.name}</span>
      {!item.enabled && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[--subtle] text-[--muted] border border-[--border]">
          Disabled
        </span>
      )}
    </li>
  );
}

export function ReorderModal({
  open,
  onOpenChange,
  presets,
  presetMetadataMap,
  manifestCache,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presets: any[];
  presetMetadataMap: Map<string, any>;
  manifestCache: Map<string, any>;
  onSave: (newPresets: any[]) => void;
}) {
  const [localPresets, setLocalPresets] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (open) {
      setLocalPresets([...presets]);
    }
  }, [open, presets]);

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

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      setLocalPresets((prev) => {
        const oldIndex = prev.findIndex((p) => p.instanceId === active.id);
        const newIndex = prev.findIndex((p) => p.instanceId === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
    setIsDragging(false);
  }

  const items: ReorderItem[] = localPresets.map((preset) => {
    const metadata = presetMetadataMap.get(preset.type);
    const manifestUrl = getManifestUrl(preset, metadata);
    const cached = manifestUrl
      ? manifestCache.get(standardiseManifestUrl(manifestUrl))
      : undefined;
    return {
      instanceId: preset.instanceId,
      name: preset.options?.name || metadata?.NAME || preset.type,
      type: metadata?.ID || preset.type,
      logo: cached?.logo || preset.logo || metadata?.LOGO,
      enabled: preset.enabled ?? true,
    };
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Reorder Addon Priority"
    >
      <div className="space-y-4">
        <p className="text-sm text-[--muted]">
          Drag addons to change their priority. Addons higher in the list have
          higher priority during deduplication and also controls sorting{' '}
          <b>when sorting by the addon criterion</b>.
        </p>
        <DndContext
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          onDragStart={() => setIsDragging(true)}
          sensors={sensors}
        >
          <SortableContext
            items={items.map((i) => i.instanceId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {items.map((item) => (
                <SortableReorderItem key={item.instanceId} item={item} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            intent="primary-subtle"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onSave(localPresets);
              onOpenChange(false);
            }}
          >
            Save Order
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function getManifestUrl(preset: any, metadata: any): string | undefined {
  if (metadata?.ID === 'custom' || metadata?.ID === 'aiostreams') {
    return preset.options?.manifestUrl;
  }
  const url = preset.options?.url;
  if (!url) return undefined;
  try {
    const urlObj = new URL(url);
    if (urlObj.pathname.endsWith('/manifest.json')) {
      return url;
    }
  } catch {}
}

function standardiseManifestUrl(url: string) {
  return url.replace(/^stremio:\/\//, 'https://').replace(/\/$/, '');
}
