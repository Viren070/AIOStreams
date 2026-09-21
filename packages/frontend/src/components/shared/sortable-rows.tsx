import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  TouchSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { IconButton } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { FaRegTrashAlt, FaArrowUp, FaArrowDown } from 'react-icons/fa';

export const rowClass =
  'px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border flex gap-3 relative';
export const gripClass =
  'rounded-full w-6 h-auto bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move shrink-0';
/**
 * A row is one line on desktop. There is no room for that below `md`, so the
 * row stacks: the controls take the first line and every field gets the full
 * width underneath.
 */
export const rowContentClass =
  'flex-1 min-w-0 flex flex-col md:flex-row gap-2 md:items-center';
/** Control strip above the fields while stacked; dissolves into the row at `md`. */
export const rowControlsClass =
  'flex items-center justify-end gap-2 md:contents';
/** The control the strip leads with, opposite the actions. */
export const rowLeadControlClass = 'shrink-0 mr-auto md:mr-0';
/** Actions head the stack but trail the row, so they are reordered at `md`. */
export const rowActionsClass = 'flex gap-1 justify-end md:order-last';

export interface SortableRows {
  /** Row count, including synced placeholders. */
  count: number;
  /** Stable React key and sortable id for the row at `index`. */
  keyAt: (index: number) => string;
  /** Ids registered with `SortableContext`, in render order. */
  sortableIds: string[];
  move: (from: number, to: number) => void;
  removeAt: (index: number) => void;
  dndProps: Pick<
    React.ComponentProps<typeof DndContext>,
    'sensors' | 'modifiers' | 'onDragStart' | 'onDragEnd'
  >;
}

/**
 * Owns row identity and reordering for a draggable list.
 *
 * Rows hold free-form text, so there is nothing in a value to key on: keys are
 * synthetic and every reorder or removal has to carry them, otherwise React
 * reuses a row's DOM (and the caret inside it) for a different entry.
 */
export function useSortableRows<T>(
  values: T[],
  onValuesChange: (values: T[]) => void
): SortableRows {
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const keysRef = useRef<string[]>([]);
  const counterRef = useRef(0);
  // Values also change from outside the list (import, sync, reset); top up or
  // trim to match, keeping the keys already handed out.
  while (keysRef.current.length < values.length) {
    keysRef.current.push(`row-${counterRef.current++}`);
  }
  keysRef.current.length = values.length;

  const [isDragging, setIsDragging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    })
  );

  // Stop the page scrolling out from under a touch drag.
  useEffect(() => {
    if (!isDragging) return;
    const preventTouchMove = (e: TouchEvent) => e.preventDefault();
    document.body.addEventListener('touchmove', preventTouchMove, {
      passive: false,
    });
    return () =>
      document.body.removeEventListener('touchmove', preventTouchMove);
  }, [isDragging]);

  const move = useCallback(
    (from: number, to: number) => {
      keysRef.current = arrayMove(keysRef.current, from, to);
      onValuesChange(arrayMove(valuesRef.current, from, to));
    },
    [onValuesChange]
  );

  const removeAt = useCallback(
    (index: number) => {
      keysRef.current = keysRef.current.filter((_, i) => i !== index);
      onValuesChange(valuesRef.current.filter((_, i) => i !== index));
    },
    [onValuesChange]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setIsDragging(false);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = keysRef.current.indexOf(String(active.id));
      const to = keysRef.current.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      move(from, to);
    },
    [move]
  );

  return {
    count: values.length,
    keyAt: (index) => keysRef.current[index],
    sortableIds: [...keysRef.current],
    move,
    removeAt,
    dndProps: {
      sensors,
      modifiers: [restrictToVerticalAxis],
      onDragStart: () => setIsDragging(true),
      onDragEnd: handleDragEnd,
    },
  };
}

/** `DndContext` + `SortableContext` shell wrapping every list. */
export function SortableList({
  rows,
  children,
}: {
  rows: SortableRows;
  children: ReactNode;
}) {
  return (
    <DndContext {...rows.dndProps}>
      <SortableContext
        items={rows.sortableIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2">{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/** Draggable row card, styled to match the sort order editors. */
export function SortableRow({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
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
      <div className={rowClass}>
        <div className={gripClass} {...attributes} {...listeners} />
        <div className={rowContentClass}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Move-up / move-down / delete buttons shared by every list item. Holding
 * shift jumps the row to the end it is heading for, which beats dragging a
 * long list past its own scroll.
 */
export function ItemActions({
  rows,
  index,
}: {
  rows: SortableRows;
  index: number;
}) {
  return (
    <>
      <Tooltip
        trigger={
          <IconButton
            size="sm"
            rounded
            icon={<FaArrowUp />}
            intent="primary-subtle"
            aria-label="Move up"
            disabled={index === 0}
            onClick={(e) => rows.move(index, e.shiftKey ? 0 : index - 1)}
          />
        }
      >
        Move up (shift to move to top)
      </Tooltip>
      <Tooltip
        trigger={
          <IconButton
            size="sm"
            rounded
            icon={<FaArrowDown />}
            intent="primary-subtle"
            aria-label="Move down"
            disabled={index === rows.count - 1}
            onClick={(e) =>
              rows.move(index, e.shiftKey ? rows.count - 1 : index + 1)
            }
          />
        }
      >
        Move down (shift to move to bottom)
      </Tooltip>
      <IconButton
        size="sm"
        rounded
        icon={<FaRegTrashAlt />}
        intent="alert-subtle"
        aria-label="Remove"
        onClick={() => rows.removeAt(index)}
      />
    </>
  );
}
