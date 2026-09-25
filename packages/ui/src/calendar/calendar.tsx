import { cva } from 'class-variance-authority';
import * as React from 'react';
import { DayPicker, DayPickerProps } from 'react-day-picker';
import { ButtonAnatomy } from '../button';
import { cn, ComponentAnatomy, defineStyleAnatomy } from '../core/styling';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const CalendarAnatomy = defineStyleAnatomy({
  root: cva(['UI-Calendar__root', 'p-3']),
  months: cva([
    'UI-Calendar__months',
    'relative flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
  ]),
  month: cva(['UI-Calendar__month', 'space-y-4']),
  monthCaption: cva([
    'UI-Calendar__monthCaption',
    'flex justify-center pt-1 relative items-center',
  ]),
  captionLabel: cva(['UI-Calendar__captionLabel', 'text-sm font-medium']),
  nav: cva(['UI-Calendar__nav', 'absolute top-0 flex w-full justify-between']),
  // buttonPrevious: cva([
  //     "UI-Calendar__buttonPrevious",
  //     ButtonAnatomy.root({ size: "sm", intent: "gray-basic" }),

  // ]),
  // buttonNext: cva([
  //     "UI-Calendar__buttonNext",
  //     ButtonAnatomy.root({ size: "sm", intent: "gray-basic" }),
  // ]),
  chevron: cva([
    'UI-Calendar__chevron',
    ButtonAnatomy.root({ size: 'sm', intent: 'gray-basic' }),
    'relative z-10',
  ]),
  monthGrid: cva([
    'UI-Calendar__monthGrid',
    'w-full border-collapse space-y-1',
  ]),
  weekdays: cva(['UI-Calendar__weekdays', 'flex']),
  weekday: cva([
    'UI-Calendar__weekday',
    'text-[--muted] rounded-[--radius] w-9 font-normal text-[0.8rem]',
  ]),
  week: cva(['UI-Calendar__week', 'flex w-full mt-2']),
  day: cva([
    'UI-Calendar__day',
    'h-9 w-9 text-center text-sm p-0 relative',
    '[&:has([aria-selected].range_end)]:rounded-r-[--radius]',
    '[&:has([aria-selected].outside)]:bg-[--subtle]/50',
    '[&:has([aria-selected])]:bg-[--subtle]',
    'first:[&:has([aria-selected])]:rounded-l-[--radius]',
    'last:[&:has([aria-selected])]:rounded-r-[--radius]',
    'focus-within:relative focus-within:z-20',
  ]),
  dayButton: cva([
    'UI-Calendar__dayButton',
    'h-9 w-9 p-0 font-normal aria-selected:opacity-100',
  ]),
  range_end: cva(['UI-Calendar__range_end']),
  selected: cva([
    'UI-Calendar__selected',
    'bg-brand text-white hover:bg-brand hover:text-white',
    'focus:bg-brand focus:text-white rounded-[--radius] font-semibold',
  ]),
  today: cva([
    'UI-Calendar__today',
    'bg-[--subtle] text-[--foreground] rounded-[--radius]',
  ]),
  outside: cva([
    'UI-Calendar__outside',
    '!text-[--muted] opacity-20',
    'aria-selected:bg-transparent',
    'aria-selected:opacity-30',
  ]),
  disabled: cva(['UI-Calendar__disabled', 'text-[--muted] opacity-30']),
  range_middle: cva([
    'UI-Calendar__range_middle',
    'aria-selected:bg-[--subtle]',
    'aria-selected:text-[--foreground]',
  ]),
  hidden: cva(['UI-Calendar__hidden', 'invisible']),
});

/* -------------------------------------------------------------------------------------------------
 * Calendar
 * -----------------------------------------------------------------------------------------------*/

export type CalendarProps = DayPickerProps &
  ComponentAnatomy<typeof CalendarAnatomy>;

export function Calendar(props: CalendarProps) {
  const {
    className,
    classNames,
    monthsClass,
    monthClass,
    monthCaptionClass,
    captionLabelClass,
    navClass,
    chevronClass,
    monthGridClass,
    weekdaysClass,
    weekdayClass,
    weekClass,
    dayClass,
    dayButtonClass,
    range_endClass,
    selectedClass,
    todayClass,
    outsideClass,
    disabledClass,
    range_middleClass,
    hiddenClass,
    ...rest
  } = props;

  return (
    <DayPicker
      fixedWeeks
      className={cn(CalendarAnatomy.root(), className)}
      classNames={{
        months: cn(CalendarAnatomy.months(), monthsClass),
        month: cn(CalendarAnatomy.month(), monthClass),
        month_caption: cn(CalendarAnatomy.monthCaption(), monthCaptionClass),
        caption_label: cn(CalendarAnatomy.captionLabel(), captionLabelClass),
        nav: cn(CalendarAnatomy.nav(), navClass),
        button_previous: cn(CalendarAnatomy.chevron(), chevronClass),
        button_next: cn(CalendarAnatomy.chevron(), chevronClass),
        month_grid: cn(CalendarAnatomy.monthGrid(), monthGridClass),
        weekdays: cn(CalendarAnatomy.weekdays(), weekdaysClass),
        weekday: cn(CalendarAnatomy.weekday(), weekdayClass),
        week: cn(CalendarAnatomy.week(), weekClass),
        day: cn(CalendarAnatomy.day(), dayClass),
        day_button: cn(CalendarAnatomy.dayButton(), dayButtonClass),
        range_end: cn(CalendarAnatomy.range_end(), range_endClass),
        selected: cn(CalendarAnatomy.selected(), selectedClass),
        today: cn(CalendarAnatomy.today(), todayClass),
        outside: cn(CalendarAnatomy.outside(), outsideClass),
        disabled: cn(CalendarAnatomy.disabled(), disabledClass),
        range_middle: cn(CalendarAnatomy.range_middle(), range_middleClass),
        hidden: cn(CalendarAnatomy.hidden(), hiddenClass),
        ...classNames,
      }}
      components={{
        Chevron: ({
          orientation,
          className,
          size: _size,
          disabled: _disabled,
          ...props
        }) => (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              'w-4 h-4',
              orientation === 'right' && 'rotate-180',
              className
            )}
            {...props}
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        ),
      }}
      {...rest}
    />
  );
}

Calendar.displayName = 'Calendar';
