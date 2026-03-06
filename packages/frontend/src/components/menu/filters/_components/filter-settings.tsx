'use client';
import { useEffect, useState } from 'react';
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  TouchSensor,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Combobox } from '../../../ui/combobox';
import { SettingsCard } from '../../../shared/settings-card';
import { IconButton } from '../../../ui/button';
import { FaRegTrashAlt } from 'react-icons/fa';
import { useMode } from '@/context/mode';

// Types

export type FilterSettingsProps<T extends string> = {
  filterName: string;
  preferredOptions: T[];
  requiredOptions: T[];
  excludedOptions: T[];
  includedOptions: T[];
  onPreferredChange: (preferred: T[]) => void;
  onRequiredChange: (required: T[]) => void;
  onExcludedChange: (excluded: T[]) => void;
  onIncludedChange: (included: T[]) => void;
  options: { name: string; value: T }[];
};

// FilterSettings

export function FilterSettings<T extends string>({
  filterName,
  preferredOptions,
  requiredOptions,
  excludedOptions,
  includedOptions,
  onPreferredChange,
  onRequiredChange,
  onExcludedChange,
  onIncludedChange,
  options,
}: FilterSettingsProps<T>) {
  const [required, setRequired] = useState<T[]>(requiredOptions);
  const [excluded, setExcluded] = useState<T[]>(excludedOptions);
  const [preferred, setPreferred] = useState<T[]>(preferredOptions);
  const [included, setIncluded] = useState<T[]>(includedOptions);
  const [isDragging, setIsDragging] = useState(false);
  const { mode } = useMode();

  const filterToAllowedValues = (filter: T[]) => {
    return filter.filter((value) => options.some((opt) => opt.value === value));
  };

  useEffect(() => {
    setRequired(filterToAllowedValues(requiredOptions));
    setExcluded(filterToAllowedValues(excludedOptions));
    setPreferred(filterToAllowedValues(preferredOptions));
    setIncluded(filterToAllowedValues(includedOptions));
  }, [requiredOptions, excludedOptions, preferredOptions, includedOptions]);

  // DND logic
  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      const oldIndex = preferred.indexOf(active.id);
      const newIndex = preferred.indexOf(over.id);
      const newPreferred = arrayMove(preferred, oldIndex, newIndex);
      setPreferred(newPreferred);
      onPreferredChange(newPreferred);
    }
    setIsDragging(false);
  }

  function handleDragStart(event: any) {
    setIsDragging(true);
  }

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

  return (
    <div className="space-y-6">
      <SettingsCard
        title={`${filterName} Selection`}
        description={`Configure required, excluded, and preferred ${filterName.toLowerCase()}`}
      >
        <div className="space-y-4">
          {mode === 'pro' && (
            <Combobox
              label={`Required ${filterName}`}
              help={`Any stream that is not one of the required ${filterName.toLowerCase()} will be excluded.`}
              value={required}
              onValueChange={(values) => {
                setRequired(values as T[]);
                onRequiredChange(values as T[]);
              }}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.name,
                textValue: opt.name,
              }))}
              multiple
              emptyMessage={`No ${filterName.toLowerCase()} available`}
              placeholder={`Select required ${filterName.toLowerCase()}...`}
            />
          )}
          <div>
            <Combobox
              label={`Excluded ${filterName}`}
              value={excluded}
              help={`Any stream that is one of the excluded ${filterName.toLowerCase()} will be excluded.`}
              onValueChange={(values) => {
                setExcluded(values as T[]);
                onExcludedChange(values as T[]);
              }}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.name,
                textValue: opt.name,
              }))}
              multiple
              emptyMessage={`No ${filterName.toLowerCase()} available`}
              placeholder={`Select excluded ${filterName.toLowerCase()}...`}
            />
          </div>
          {mode === 'pro' && (
            <div>
              <Combobox
                label={`Included ${filterName}`}
                value={included}
                help={`Included ${filterName.toLowerCase()} will be included regardless of ANY other exclude/required filters, not just for ${filterName.toLowerCase()}`}
                onValueChange={(values) => {
                  setIncluded(values as T[]);
                  onIncludedChange(values as T[]);
                }}
                options={options.map((opt) => ({
                  value: opt.value,
                  label: opt.name,
                  textValue: opt.name,
                }))}
                multiple
                emptyMessage={`No ${filterName.toLowerCase()} available`}
                placeholder={`Select included ${filterName.toLowerCase()}...`}
              />
            </div>
          )}

          <div>
            <Combobox
              label={`Preferred ${filterName}`}
              help={`Set preferred ${filterName.toLowerCase()} and control its order below. This is used if the relevant sort criterion is enabled in the Sorting section.`}
              value={preferred}
              onValueChange={(values) => {
                setPreferred(values as T[]);
                onPreferredChange(values as T[]);
              }}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.name,
                textValue: opt.name,
              }))}
              multiple
              emptyMessage={`No ${filterName.toLowerCase()} available`}
              placeholder={`Select preferred ${filterName.toLowerCase()}...`}
            />
          </div>
        </div>
      </SettingsCard>

      {preferred.length > 0 && (
        <SettingsCard
          title="Preference Order"
          description={`Drag to reorder your preferred ${filterName.toLowerCase()}`}
        >
          <DndContext
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            sensors={sensors}
          >
            <SortableContext
              items={preferred}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {preferred.map((value) => (
                  <SortableFilterItem
                    key={value}
                    id={value}
                    name={
                      options.find((opt) => opt.value === value)?.name || value
                    }
                    onDelete={() => {
                      const newPreferred = preferred.filter((v) => v !== value);
                      setPreferred(newPreferred);
                      onPreferredChange(newPreferred);
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </SettingsCard>
      )}
    </div>
  );
}

// SortableFilterItem

function SortableFilterItem({
  id,
  name,
  onDelete,
}: {
  id: string;
  name: string;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border flex gap-3 relative">
        <div
          className="rounded-full w-6 h-auto bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move"
          {...attributes}
          {...listeners}
        />
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <span className="font-mono text-base truncate">{name}</span>
        </div>
        <div className="flex-shrink-0 ml-auto">
          <IconButton
            size="sm"
            rounded
            icon={<FaRegTrashAlt />}
            intent="alert-subtle"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
          />
        </div>
      </div>
    </div>
  );
}
