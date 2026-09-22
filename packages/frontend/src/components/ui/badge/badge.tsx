import { cva, VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn, ComponentAnatomy, defineStyleAnatomy } from '../core/styling';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const BadgeAnatomy = defineStyleAnatomy({
  root: cva(
    [
      'UI-Badge__root',
      'inline-flex flex-none text-base w-fit overflow-hidden justify-center items-center gap-2',
      'group/badge',
    ],
    {
      variants: {
        intent: {
          gray: 'text-gray-300 bg-gray-100 border border-gray-500 border-opacity-40 bg-opacity-10',
          primary:
            'text-indigo-300 bg-indigo-50 border border-indigo-500 border-opacity-40 bg-opacity-10',
          success:
            'text-green-300 bg-green-50 border border-green-500 border-opacity-40 bg-opacity-10',
          warning:
            'text-orange-300 bg-orange-50 border border-orange-500 border-opacity-40 bg-opacity-10',
          alert:
            'text-red-300 bg-red-50 border border-red-500 border-opacity-40 bg-opacity-10',
          blue: 'text-blue-300 bg-blue-50 border border-blue-500 border-opacity-40 bg-opacity-10',
          white:
            'text-white bg-gray-800 border border-gray-500 border-opacity-40 bg-opacity-10',
          'primary-solid': 'text-white bg-indigo-500',
          'success-solid': 'text-white bg-green-500',
          'alert-solid': 'text-white bg-red-400',
          'gray-solid': 'text-white bg-gray-700',
          'white-solid': 'text-gray-900 bg-white',
          unstyled: 'border text-gray-300',
        },
        size: {
          sm: 'h-[1.2rem] px-1.5 text-xs',
          md: 'h-6 px-2 text-xs',
          lg: 'h-7 px-3 text-md',
        },
        tag: {
          false: 'font-semibold tracking-wide rounded-full',
          true: 'font-semibold border-none rounded-[--radius]',
        },
      },
      defaultVariants: {
        intent: 'gray',
        size: 'md',
        tag: false,
      },
    }
  ),
  icon: cva(['UI-Badge__icon', 'inline-flex self-center flex-shrink-0']),
});

/* -------------------------------------------------------------------------------------------------
 * Badge
 * -----------------------------------------------------------------------------------------------*/

export type BadgeProps = React.ComponentPropsWithRef<'span'> &
  VariantProps<typeof BadgeAnatomy.root> &
  ComponentAnatomy<typeof BadgeAnatomy> & {
    leftIcon?: React.ReactElement;
    rightIcon?: React.ReactElement;
  };

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (props, ref) => {
    const {
      children,
      className,
      size,
      intent,
      tag = false,
      leftIcon,
      rightIcon,
      iconClass,
      ...rest
    } = props;

    return (
      <span
        ref={ref}
        className={cn(BadgeAnatomy.root({ size, intent, tag }), className)}
        {...rest}
      >
        {leftIcon && (
          <span className={cn(BadgeAnatomy.icon(), iconClass)}>{leftIcon}</span>
        )}
        {children}
        {rightIcon && (
          <span className={cn(BadgeAnatomy.icon(), iconClass)}>
            {rightIcon}
          </span>
        )}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
