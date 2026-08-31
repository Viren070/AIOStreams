import React from 'react';
import { PencilIcon, HeartIcon, LogInIcon, LogOutIcon } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';

export function AboutHero({
  addonName,
  addonDescription,
  logo,
  version,
  channel,
  commit,
  onCustomize,
  onDonate,
  isSignedIn,
  onToggleSession,
}: {
  addonName: string;
  addonDescription: string;
  logo: string;
  version: string;
  channel: 'stable' | 'nightly' | 'dev';
  commit?: string;
  onCustomize: () => void;
  onDonate: () => void;
  isSignedIn: boolean;
  onToggleSession: () => void;
}) {
  return (
    <div className="flex items-start gap-4 sm:gap-5 w-full">
      <img
        src={logo}
        alt=""
        width={72}
        height={72}
        className="w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-xl shadow-lg shrink-0"
      />

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-100 truncate min-w-0">
            {addonName}
          </h1>
          <span className="text-lg sm:text-xl font-semibold text-gray-400 pb-0.5">
            {version}
            {(channel === 'nightly' || channel === 'dev') && commit && (
              <>
                {' '}
                <a
                  href={`https://github.com/Viren070/AIOStreams/commit/${commit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[--brand] hover:underline"
                >
                  ({commit})
                </a>
              </>
            )}
          </span>
          <IconButton
            icon={<PencilIcon className="w-3.5 h-3.5" />}
            intent="gray-subtle"
            onClick={onCustomize}
            className="rounded-full shrink-0 self-center"
            size="sm"
          />
        </div>

        <p className="text-sm sm:text-base text-[--muted] mt-1.5 max-w-3xl">
          {addonDescription}
        </p>
      </div>
      <div className="hidden lg:flex items-center gap-2 shrink-0">
        <Button
          intent="gray-outline"
          size="sm"
          rounded
          leftIcon={<HeartIcon className="w-4 h-4" />}
          onClick={onDonate}
          className="shrink-0 border-red-300/30 text-red-200 hover:bg-red-500/10 hover:border-red-300/50 hover:text-red-100"
        >
          Donate
        </Button>
        <Button
          intent="gray-outline"
          size="sm"
          rounded
          leftIcon={
            isSignedIn ? (
              <LogOutIcon className="w-4 h-4" />
            ) : (
              <LogInIcon className="w-4 h-4" />
            )
          }
          onClick={onToggleSession}
          className="shrink-0"
        >
          {isSignedIn ? 'Sign Out' : 'Sign In'}
        </Button>
      </div>
    </div>
  );
}
