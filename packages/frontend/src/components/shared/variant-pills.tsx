import React from 'react';
import { cn } from '@/components/ui/core/styling';

export interface VariantOption {
  id: string;
  name?: string;
  enabled?: boolean;
  /** Present when the variant can also activate on its own. */
  when?: string;
}

interface VariantPillsProps {
  /** Already filtered by the caller; this renders exactly what it is given. */
  variants: VariantOption[];
  /** Selected variant ids. Empty is the base config. */
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}

const pill = (active: boolean) =>
  cn(
    'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
    active
      ? 'bg-[--brand]/20 text-[--brand] border-[--brand]/50'
      : 'bg-transparent text-[--muted] border-[--border] hover:bg-[--subtle]'
  );

/**
 * Base config plus one pill per variant.
 */
export function VariantPills({
  variants,
  value,
  onChange,
  className,
}: VariantPillsProps) {
  const toggle = (id: string) =>
    onChange(
      value.includes(id)
        ? value.filter((selected) => selected !== id)
        : [...value, id]
    );

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <button
        type="button"
        onClick={() => onChange([])}
        className={pill(value.length === 0)}
      >
        Base config
      </button>
      {variants.map((variant) => (
        <button
          key={variant.id}
          type="button"
          onClick={() => toggle(variant.id)}
          className={pill(value.includes(variant.id))}
          title={
            variant.when
              ? 'Also applies on its own when its condition matches'
              : undefined
          }
        >
          {variant.name || variant.id}
          {variant.when ? (
            <span className="ml-1 opacity-60">auto</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
