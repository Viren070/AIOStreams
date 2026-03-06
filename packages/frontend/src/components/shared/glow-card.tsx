'use client';
import React, { useRef } from 'react';
import { cn } from '@/components/ui/core/styling';

export interface GlowCardProps {
  className?: string;
  children: React.ReactNode;
  /** Radial gradient radius. Default: 500px */
  glowSize?: string;
  /** Alpha of the radial spotlight. Default: 0.07 */
  glowOpacity?: number;
  /** CSS transition duration for glow fade. Default: '0.5s' */
  transitionDuration?: string;
}

/**
 * A div-based card with a performant mouse-tracking radial glow effect.
 * Uses direct DOM mutation (no React state) on mousemove for zero re-renders.
 */
export function GlowCard({
  className,
  children,
  glowSize = '500px',
  glowOpacity = 0.07,
  transitionDuration = '0.5s',
}: GlowCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const topGlowRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (glowRef.current)
      glowRef.current.style.background = `radial-gradient(${glowSize} circle at ${x}px ${y}px, rgba(139, 92, 246, ${glowOpacity}), transparent 65%)`;
    if (topGlowRef.current)
      topGlowRef.current.style.background = `radial-gradient(70% 100% at ${x}px 0px, rgba(139, 92, 246, ${Math.min(1, glowOpacity * 7)}), transparent)`;
  };

  const handleMouseEnter = () => {
    if (glowRef.current) glowRef.current.style.opacity = '1';
    if (topGlowRef.current) topGlowRef.current.style.opacity = '1';
  };

  const handleMouseLeave = () => {
    if (glowRef.current) glowRef.current.style.opacity = '0';
    if (topGlowRef.current) topGlowRef.current.style.opacity = '0';
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-xl border border-gray-700/50 bg-gray-800/40',
        className
      )}
    >
      {/* Radial spotlight — opacity toggled via ref, no re-render */}
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{ opacity: 0, transition: `opacity ${transitionDuration} ease` }}
      />
      {/* Top edge shimmer */}
      <div
        ref={topGlowRef}
        className="pointer-events-none absolute top-0 inset-x-0 h-px rounded-t-xl"
        style={{ opacity: 0, transition: `opacity ${transitionDuration} ease` }}
      />
      {children}
    </div>
  );
}
