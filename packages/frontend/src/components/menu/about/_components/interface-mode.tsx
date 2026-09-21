import React from 'react';
import { useMode } from '@/context/mode';
import { GlowCard } from '@/components/shared/glow-card';
import { ModeSwitch } from '@/components/ui/mode-switch/mode-switch';

export function InterfaceMode() {
  const { mode, setMode } = useMode();

  return (
    <GlowCard className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-white">Interface</h3>
        <p className="text-sm text-[--muted] mt-1">
          {mode === 'pro'
            ? 'Advanced is on: the Sorting page and all advanced options are shown.'
            : 'Simple hides the Sorting page and the more advanced options.'}
        </p>
      </div>
      <ModeSwitch
        value={mode}
        onChange={setMode}
        className="w-full sm:w-48 sm:h-10 shrink-0"
      />
    </GlowCard>
  );
}
