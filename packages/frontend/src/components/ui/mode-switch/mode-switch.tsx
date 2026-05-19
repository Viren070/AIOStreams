import React from 'react';
import { cn } from '@/components/ui/core/styling';
import { Mode } from '@/context/mode';

interface ModeSwitchProps {
  value: Mode;
  onChange: (value: Mode) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ModeSwitch({
  value,
  onChange,
  size = 'md',
  className,
}: ModeSwitchProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [highlightStyle, setHighlightStyle] = React.useState({
    width: '50%',
    transform: 'translateX(0)',
  });

  React.useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.offsetWidth / 2;
      setHighlightStyle({
        width: `${width}px`,
        transform: `translateX(${value === 'pro' ? width : 0}px)`,
      });
    }
  }, [value]);

  const sizeClasses = {
    sm: 'h-10 text-sm',
    md: 'h-12 text-base',
    lg: 'h-14 text-lg',
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex rounded-full bg-gray-800/60 border border-gray-800 overflow-hidden',
        sizeClasses[size],
        className
      )}
    >
      {/* Animated highlight */}
      <div
        className="absolute top-0 bottom-0 bg-white border border-[--brand]/30 rounded-full transition-transform duration-300 ease-in-out"
        style={highlightStyle}
      />

      {/* Buttons */}
      <button
        onClick={() => onChange('noob')}
        className={cn(
          'relative flex-1 flex items-center justify-center font-medium transition-colors duration-200',
          value === 'noob' ? 'text-black' : 'text-gray-400 hover:text-gray-300'
        )}
      >
        <div className="text-md">
          <b>SIMPLE</b>
        </div>
      </button>
      <button
        onClick={() => onChange('pro')}
        className={cn(
          'relative flex-1 flex items-center justify-center font-medium transition-colors duration-200',
          value === 'pro' ? 'text-black' : 'text-gray-400 hover:text-gray-300'
        )}
      >
        <b>ADVANCED</b>
      </button>
    </div>
  );
}
