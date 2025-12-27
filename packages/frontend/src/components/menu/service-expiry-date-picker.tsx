'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Popover } from '../ui/popover';
import { cn } from '../ui/core/styling';
import { FiCalendar, FiChevronLeft, FiChevronRight } from 'react-icons/fi';

interface ServiceExpiryDatePickerProps {
  value?: string;
  onSelect: (value: string) => void;
  onClear: () => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ServiceExpiryDatePicker({
  value,
  onSelect,
  onClear,
}: ServiceExpiryDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = useMemo(() => parseDate(value), [value]);
  const [currentMonth, setCurrentMonth] = useState<Date>(
    () => selectedDate ?? today()
  );

  useEffect(() => {
    if (open) {
      setCurrentMonth(selectedDate ?? today());
    }
  }, [open, selectedDate]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(currentMonth),
    [currentMonth]
  );

  const weeks = useMemo(() => buildCalendar(currentMonth), [currentMonth]);

  const handleSelect = (date: Date) => {
    onSelect(formatDate(date));
    setOpen(false);
  };

  const handleClear = () => {
    onClear();
    setOpen(false);
  };

  const handleToday = () => {
    const now = today();
    setCurrentMonth(now);
    onSelect(formatDate(now));
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          type="button"
          size="sm"
          intent="gray-outline"
          leftIcon={<FiCalendar className="h-4 w-4" />}
        >
          {selectedDate ? selectedDate.toLocaleDateString() : 'Pick a date'}
        </Button>
      }
      className="w-[18rem] space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          intent="gray-outline"
          onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
          leftIcon={<FiChevronLeft className="h-4 w-4" />}
        />
        <span className="font-semibold text-base">{monthLabel}</span>
        <Button
          type="button"
          size="sm"
          intent="gray-outline"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          leftIcon={<FiChevronRight className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs uppercase text-[--muted]">
        {DAY_LABELS.map((label) => (
          <span key={label} className="text-center font-medium">
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 text-sm">
        {weeks.map((week, weekIndex) =>
          week.map((date, dayIndex) => {
            if (!date) {
              return <span key={`${weekIndex}-${dayIndex}`} />;
            }

            const isSelected = selectedDate
              ? isSameDay(date, selectedDate)
              : false;
            const isToday = isSameDay(date, today());

            return (
              <button
                key={`${weekIndex}-${dayIndex}`}
                type="button"
                className={cn(
                  'h-9 w-9 rounded-md transition text-sm flex items-center justify-center',
                  isSelected
                    ? 'bg-[--brand] text-white font-semibold shadow'
                    : 'bg-[--paper] hover:bg-[--subtle] border border-transparent',
                  isToday && !isSelected
                    ? 'border border-[--brand] text-[--brand]'
                    : null
                )}
                onClick={() => handleSelect(date)}
              >
                {date.getDate()}
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[--border] pt-2">
        <Button
          type="button"
          size="sm"
          intent="gray-outline"
          onClick={handleToday}
        >
          Today
        </Button>
        <Button
          type="button"
          size="sm"
          intent="gray-outline"
          onClick={handleClear}
        >
          Clear
        </Button>
      </div>
    </Popover>
  );
}

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return candidate;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addMonths(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return new Date(next.getFullYear(), next.getMonth(), 1);
}

function buildCalendar(month: Date): Array<Array<Date | null>> {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstOfMonth = new Date(year, monthIndex, 1);
  const firstWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const slots: Array<Date | null> = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    slots.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    slots.push(new Date(year, monthIndex, day));
  }

  while (slots.length % 7 !== 0) {
    slots.push(null);
  }

  const weeks: Array<Array<Date | null>> = [];
  for (let i = 0; i < slots.length; i += 7) {
    weeks.push(slots.slice(i, i + 7));
  }
  return weeks;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
