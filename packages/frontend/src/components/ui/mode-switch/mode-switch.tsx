import React from 'react';
import { cn } from '@/components/ui/core/styling';
import { Mode } from '@/context/mode';

interface ModeSwitchProps {
  value: Mode;
  onChange: (value: Mode) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-9 text-xs',
  md: 'h-11 text-sm',
  lg: 'h-12 text-base',
};

export function ModeSwitch({
  value,
  onChange,
  size = 'md',
  className,
}: ModeSwitchProps) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'relative flex rounded-full bg-gray-800/60 border border-gray-800',
        sizeClasses[size],
        className
      )}
    >
      {/* Thumb, inset so it reads as a pill inside the track rather than filling it */}
      <div
        className="absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] bg-white border border-[--brand]/30 rounded-full transition-transform duration-300 ease-in-out"
        style={{ transform: `translateX(${value === 'pro' ? '100%' : '0'})` }}
      />

      {/* Buttons */}
      <button
        type="button"
        role="radio"
        aria-checked={value === 'noob'}
        onClick={() => onChange('noob')}
        className={cn(
          'relative flex-1 flex items-center justify-center font-bold tracking-wide transition-colors duration-200',
          value === 'noob' ? 'text-black' : 'text-gray-400 hover:text-gray-300'
        )}
      >
        SIMPLE
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'pro'}
        onClick={() => onChange('pro')}
        className={cn(
          'relative flex-1 flex items-center justify-center font-bold tracking-wide transition-colors duration-200',
          value === 'pro' ? 'text-black' : 'text-gray-400 hover:text-gray-300'
        )}
      >
        ADVANCED
      </button>
    </div>
  );
}
