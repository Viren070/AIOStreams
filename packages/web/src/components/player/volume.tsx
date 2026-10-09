import React from 'react';
import { LuVolume1, LuVolume2, LuVolumeX } from 'react-icons/lu';
import { settings, useSetting } from '../../lib/settings';
import type { PlayerController } from '../../lib/playback/controller';
import { ControlButton } from './buttons';
import { arrowDirection } from './seek-bar';

function VolumeBar({
  level,
  max,
  onChange,
}: {
  level: number;
  max: number;
  onChange(volume: number): void;
}) {
  const [step] = useSetting(settings.volumeStep);
  const bar = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const at = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * max * 100) / 100;
  };
  const share = (volume: number) => (Math.min(volume, max) / max) * 100;

  return (
    <div
      ref={bar}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={Math.round(max * 100)}
      aria-valuenow={Math.round(level * 100)}
      tabIndex={0}
      // The volume has its own keys, so arrows pass over it.
      data-nav="skip"
      data-ui="volume-bar"
      className="relative flex h-5 w-20 flex-none cursor-pointer touch-none items-center rounded-full"
      onKeyDown={(e) => {
        const direction = arrowDirection(e.key);
        if (!direction) return;
        e.preventDefault();
        const next = Math.round((level + (direction * step) / 100) * 100) / 100;
        onChange(Math.min(max, Math.max(0, next)));
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onChange(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging) onChange(at(e.clientX));
      }}
      onPointerUp={() => setDragging(false)}
    >
      <div
        data-ui="volume-track"
        className="relative h-1 w-full overflow-hidden rounded-full bg-white/20"
      >
        {max > 1 && (
          <div
            data-ui="volume-boost"
            className="absolute inset-y-0 right-0 bg-white/15"
            style={{ left: `${share(1)}%` }}
          />
        )}
        <div
          data-ui="volume-level"
          className="absolute inset-y-0 left-0 bg-white"
          style={{ width: `${share(level)}%` }}
        />
        {level > 1 && max > 1 && (
          <div
            data-ui="volume-boost-level"
            className="absolute inset-y-0 left-0 bg-red-400"
            style={{
              width: `${share(level)}%`,
              opacity: (Math.min(level, max) - 1) / (max - 1),
            }}
          />
        )}
      </div>
      <div
        data-ui="volume-thumb"
        className="absolute size-3 -translate-x-1/2 rounded-full bg-white shadow"
        style={{ left: `${share(level)}%` }}
      />
    </div>
  );
}

export function Volume({ player }: { player: PlayerController }) {
  const { volume, muted, maxVolume } = player.state;
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? LuVolumeX : level < 0.5 ? LuVolume1 : LuVolume2;
  return (
    <div data-ui="volume" className="group/volume hidden items-center sm:flex">
      <ControlButton
        name="mute"
        label={muted ? 'Unmute' : 'Mute'}
        onClick={player.toggleMute}
      >
        <Icon />
      </ControlButton>
      <div className="w-0 overflow-hidden transition-[width] duration-200 group-focus-within/volume:w-24 group-hover/volume:w-24 md:group-focus-within/volume:w-36 md:group-hover/volume:w-36">
        <div className="flex w-24 items-center gap-2 px-2 md:w-36">
          <VolumeBar
            level={level}
            max={maxVolume}
            onChange={player.setVolume}
          />
          <span
            data-ui="volume-value"
            className="hidden text-xs tabular-nums text-white/85 md:inline"
          >
            {Math.round(level * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
