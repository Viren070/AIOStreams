'use client';

import * as React from 'react';
import { cva, VariantProps } from 'class-variance-authority';
import { cn } from '../core/styling';

/* -------------------------------------------------------------------------------------------------
 * Badge Anatomy
 * -----------------------------------------------------------------------------------------------*/

const badgeVariants = cva(
  [
    'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
    'transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  ],
  {
    variants: {
      intent: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        success:
          'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
        warning: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
        danger: 'bg-red-500/20 text-red-400 border border-red-500/30',
        info: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
        purple: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
        custom: '', // Allow custom styling via style prop
      },
      size: {
        sm: 'text-[0.65rem] px-1.5 py-0.5',
        md: 'text-xs px-2 py-0.5',
        lg: 'text-sm px-2.5 py-1',
      },
    },
    defaultVariants: {
      intent: 'default',
      size: 'md',
    },
  }
);

/* -------------------------------------------------------------------------------------------------
 * Badge Component
 * -----------------------------------------------------------------------------------------------*/

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Custom background color (overrides intent)
   */
  backgroundColor?: string;
  /**
   * Custom text color (overrides intent)
   */
  textColor?: string;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      intent,
      size,
      backgroundColor,
      textColor,
      style,
      children,
      ...props
    },
    ref
  ) => {
    const customStyles: React.CSSProperties = {
      ...style,
      ...(backgroundColor && { backgroundColor }),
      ...(textColor && { color: textColor }),
    };

    return (
      <span
        ref={ref}
        className={cn(
          badgeVariants({ intent: backgroundColor ? 'custom' : intent, size }),
          backgroundColor && 'border border-current/30',
          className
        )}
        style={customStyles}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

/* -------------------------------------------------------------------------------------------------
 * ServiceExpiryBadge - Specialized badge for addon service expiry
 * -----------------------------------------------------------------------------------------------*/

export interface ServiceExpiryBadgeProps {
  tagType?: string;
  expiryDate?: string; // ISO date string (YYYY-MM-DD)
  className?: string;
}

export const ServiceExpiryBadge: React.FC<ServiceExpiryBadgeProps> = ({
  tagType,
  expiryDate,
  className,
}) => {
  const resolvedType = (tagType ?? 'none').toString();
  const normalizedType = resolvedType.toLowerCase();

  if (!resolvedType || normalizedType === 'none') {
    return null;
  }

  // Parse date string as local date (not UTC) to avoid timezone issues
  const parseLocalDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const isExpired = () => {
    if (normalizedType !== 'expires' || !expiryDate) return false;
    const expiry = parseLocalDate(expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry < today;
  };

  const formatCustomLabel = (value: string) =>
    value.replace(/[_-]+/g, ' ').trim().toUpperCase();

  const getLabel = () => {
    switch (normalizedType) {
      case 'lifetime':
        return 'LIFETIME';
      case 'free':
        return 'FREE';
      case 'expires':
        if (expiryDate) {
          const date = parseLocalDate(expiryDate);
          const formatted = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          return isExpired() ? `Expired ${formatted}` : `Expires ${formatted}`;
        }
        return 'EXPIRES';
      default:
        return formatCustomLabel(resolvedType);
    }
  };

  const getIntent = (): BadgeProps['intent'] => {
    if (normalizedType === 'lifetime') return 'purple';
    if (normalizedType === 'free') return 'success';
    if (normalizedType === 'expires') return isExpired() ? 'danger' : 'warning';
    return 'info';
  };

  return (
    <Badge
      intent={getIntent()}
      size="sm"
      className={cn('uppercase', className)}
    >
      {getLabel()}
    </Badge>
  );
};

ServiceExpiryBadge.displayName = 'ServiceExpiryBadge';
