'use client';

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cva, VariantProps } from 'class-variance-authority';
import {
  BasicField,
  BasicFieldOptions,
  extractBasicFieldProps,
} from '../basic-field';
import { cn, ComponentAnatomy, defineStyleAnatomy } from '../core/styling';
import { mergeRefs } from '../core/utils';
import { Popover } from '@/components/ui/popover';
import { AiOutlineExclamationCircle } from 'react-icons/ai';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const SliderAnatomy = defineStyleAnatomy({
  root: cva(
    [
      'UI-Slider__root',
      'relative flex w-full touch-none select-none items-center',
    ],
    {
      variants: {
        size: {
          sm: 'h-4 w-full',
          md: 'h-5 w-full',
          lg: 'h-6 w-full',
        },
      },
      defaultVariants: {
        size: 'md',
      },
    }
  ),
  track: cva(
    [
      'UI-Slider__track',
      'relative h-1.5 w-full grow overflow-hidden rounded-full',
      'bg-gray-200 dark:bg-gray-700',
      'data-[disabled=true]:opacity-50',
    ],
    {
      variants: {
        size: {
          sm: 'h-1 w-full',
          md: 'h-1.5 w-full',
          lg: 'h-2 w-full',
        },
        defaultVariants: {
          size: 'md',
        },
      },
    }
  ),
  range: cva([
    'UI-Slider__range',
    'absolute h-full bg-brand',
    'data-[disabled=true]:opacity-50',
  ]),
  thumb: cva(
    [
      'UI-Slider__thumb',
      'block h-4 w-4 rounded-full',
      'border border-brand/50 bg-white shadow transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] focus-visible:ring-offset-1',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[disabled=true]:opacity-50',
    ],
    {
      variants: {
        size: {
          sm: 'h-4 w-4',
          md: 'h-5 w-5',
          lg: 'h-6 w-6',
        },
      },
      defaultVariants: {
        size: 'md',
      },
    }
  ),
  mark: cva([
    'UI-Slider__mark',
    'absolute top-6 -translate-x-1/2 text-xs text-gray-500',
  ]),
  markIndicator: cva([
    'UI-Slider__markIndicator',
    'absolute top-[7px] h-1 w-0.5 -translate-x-1/2 bg-gray-300 dark:bg-gray-600',
  ]),
  label: cva([
    'UI-Slider__label',
    'relative font-normal',
    'data-[disabled=true]:text-gray-300 cursor-pointer user-select-none select-none',
  ]),
});

/* -------------------------------------------------------------------------------------------------
 * Slider
 * -----------------------------------------------------------------------------------------------*/

export type SliderProps = BasicFieldOptions &
  ComponentAnatomy<typeof SliderAnatomy> &
  Omit<
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
    'value' | 'defaultValue' | 'onValueChange'
  > & {
    /**
     * The value of the slider
     */
    value?: number[];
    /**
     * Callback fired when the value changes
     */
    onValueChange?: (value: number[]) => void;
    /**
     * Default value when uncontrolled
     */
    defaultValue?: number[];
    /**
     * Whether to show marks on the slider
     */
    showMarks?: boolean;
    /**
     * Custom marks to show on the slider
     */
    marks?: { value: number; label: string }[];
    /**
     * Additional help text shown in a popover
     */
    moreHelp?: React.ReactNode;
    /**
     * The size of the slider
     */
    size?: 'sm' | 'md' | 'lg';
  };

export const Slider = React.forwardRef<HTMLSpanElement, SliderProps>(
  (props, ref) => {
    const [
      {
        value: controlledValue,
        className,
        onValueChange,
        defaultValue,
        trackClass,
        rangeClass,
        thumbClass,
        markClass,
        markIndicatorClass,
        labelClass,
        showMarks,
        marks,
        moreHelp,
        size,
        ...rest
      },
      { label, ...basicFieldProps },
    ] = extractBasicFieldProps(props, React.useId());

    const isFirst = React.useRef(true);

    const [_value, _setValue] = React.useState<number[]>(
      controlledValue ?? defaultValue ?? [0]
    );

    const handleOnValueChange = React.useCallback((value: number[]) => {
      _setValue(value);
      onValueChange?.(value);
    }, []);

    React.useEffect(() => {
      if (!defaultValue || !isFirst.current) {
        _setValue(controlledValue ?? [0]);
      }
      isFirst.current = false;
    }, [controlledValue]);

    // Generate default marks if showMarks is true and no custom marks provided
    const defaultMarks = React.useMemo(() => {
      if (!showMarks || marks) return [];
      const step = rest.step || 1;
      const min = rest.min || 0;
      const max = rest.max || 100;
      const count = Math.floor((max - min) / step) + 1;
      return Array.from({ length: count }, (_, i) => ({
        value: min + i * step,
        label: (min + i * step).toString(),
      }));
    }, [showMarks, marks, rest.step, rest.min, rest.max]);

    const marksToRender = marks || defaultMarks;

    return (
      <BasicField {...basicFieldProps} id={basicFieldProps.id}>
        <div className="flex flex-col gap-1">
          {label && (
            <div className="flex items-center gap-1">
              <label
                className={cn(SliderAnatomy.label(), labelClass)}
                htmlFor={basicFieldProps.id}
                data-disabled={basicFieldProps.disabled}
              >
                {label}
              </label>
              {moreHelp && (
                <Popover
                  className="text-sm"
                  trigger={
                    <AiOutlineExclamationCircle className="transition-opacity opacity-45 hover:opacity-90" />
                  }
                >
                  {moreHelp}
                </Popover>
              )}
            </div>
          )}

          <SliderPrimitive.Root
            ref={mergeRefs([ref])}
            className={cn(SliderAnatomy.root({ size }), className)}
            value={_value}
            onValueChange={handleOnValueChange}
            disabled={basicFieldProps.disabled || basicFieldProps.readonly}
            data-disabled={basicFieldProps.disabled}
            data-readonly={basicFieldProps.readonly}
            data-error={!!basicFieldProps.error}
            {...rest}
          >
            <SliderPrimitive.Track
              className={cn(SliderAnatomy.track(), trackClass)}
            >
              <SliderPrimitive.Range
                className={cn(SliderAnatomy.range(), rangeClass)}
              />
            </SliderPrimitive.Track>

            {marksToRender.map(({ value, label }) => (
              <React.Fragment key={value}>
                <div
                  className={cn(
                    SliderAnatomy.markIndicator(),
                    markIndicatorClass
                  )}
                  style={{
                    left: `${
                      ((value - (rest.min || 0)) /
                        ((rest.max || 100) - (rest.min || 0))) *
                      100
                    }%`,
                  }}
                />
                <div
                  className={cn(SliderAnatomy.mark(), markClass)}
                  style={{
                    left: `${
                      ((value - (rest.min || 0)) /
                        ((rest.max || 100) - (rest.min || 0))) *
                      100
                    }%`,
                  }}
                >
                  {label}
                </div>
              </React.Fragment>
            ))}

            {_value.map((_, i) => (
              <SliderPrimitive.Thumb
                key={i}
                className={cn(SliderAnatomy.thumb({ size }), thumbClass)}
              />
            ))}
          </SliderPrimitive.Root>
        </div>
      </BasicField>
    );
  }
);

Slider.displayName = 'Slider';
