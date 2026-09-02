import React from 'react';
import { PlayIcon, LayoutTemplateIcon, DownloadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlowCard } from '@/components/shared/glow-card';

interface GetStartedCardProps {
  isSignedIn: boolean;
  /** Whether anything has been configured yet, which picks the actions shown. */
  hasConfig: boolean;
  onStartSetup: () => void;
  onContinue: () => void;
  onBrowseSetups: () => void;
  onInstall: () => void;
  onSignIn: () => void;
}

/**
 * One dominant action whose label follows the configuration's state, instead
 * of three equal-weight buttons that all claim to be the way in.
 */
export function GetStartedCard({
  isSignedIn,
  hasConfig,
  onStartSetup,
  onContinue,
  onBrowseSetups,
  onInstall,
  onSignIn,
}: GetStartedCardProps) {
  return (
    <GlowCard className="p-5 sm:p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-white">
          {hasConfig ? 'Your configuration' : 'Get started'}
        </h3>
        <p className="text-sm text-[--muted] mt-1">
          {hasConfig
            ? 'Pick up where you left off, or grab your install link.'
            : 'Pick a ready-made setup or build one yourself. It takes a couple of minutes.'}
          {hasConfig && !isSignedIn && (
            <span className="block text-xs text-gray-500 mt-1">
              Not saved yet — finish on Save &amp; Install to get your install
              link.
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {hasConfig ? (
          <>
            <Button
              intent="primary"
              rounded
              leftIcon={<PlayIcon className="w-4 h-4" />}
              className="w-full sm:flex-1 h-11"
              onClick={onContinue}
            >
              Continue setup
            </Button>
            <Button
              intent="gray-outline"
              rounded
              leftIcon={<DownloadIcon className="w-4 h-4" />}
              className="w-full sm:flex-1 h-11"
              onClick={onInstall}
            >
              Save &amp; install
            </Button>
          </>
        ) : (
          <>
            <Button
              intent="primary"
              rounded
              leftIcon={<PlayIcon className="w-4 h-4" />}
              className="w-full sm:flex-1 h-11"
              onClick={onStartSetup}
            >
              Start setup
            </Button>
            <Button
              intent="gray-outline"
              rounded
              leftIcon={<LayoutTemplateIcon className="w-4 h-4" />}
              className="w-full sm:flex-1 h-11"
              onClick={onBrowseSetups}
            >
              Browse setups
            </Button>
          </>
        )}
      </div>

      {!isSignedIn && (
        <p className="text-xs text-gray-500">
          Already have a configuration?{' '}
          <button
            type="button"
            onClick={onSignIn}
            className="text-[--brand] hover:underline"
          >
            Sign in
          </button>{' '}
          to load it.
        </p>
      )}
    </GlowCard>
  );
}
