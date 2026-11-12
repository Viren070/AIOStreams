'use client';

import * as React from 'react';
import type { IconType } from 'react-icons';
import {
  FaAndroid,
  FaApple,
  FaGlobe,
  FaLinux,
  FaWindows,
} from 'react-icons/fa';
import { LuTv, LuTvMinimalPlay } from 'react-icons/lu';
import type { Platform } from '@/lib/downloads';

export const PLATFORM_ICONS: Record<Platform, IconType> = {
  windows: FaWindows,
  mac: FaApple,
  linux: FaLinux,
  android: FaAndroid,
  'android-tv': LuTvMinimalPlay,
  lg: LuTv,
  samsung: LuTv,
  browser: FaGlobe,
  apple: FaApple,
};

export interface Detected {
  platform: Platform;
  /** Index into the platform's files of the one to offer first. */
  file: number;
}

interface HighEntropyNavigator extends Navigator {
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
  };
}

async function architecture(): Promise<string | undefined> {
  const data = (navigator as HighEntropyNavigator).userAgentData;
  if (!data) return undefined;
  try {
    return (await data.getHighEntropyValues(['architecture'])).architecture;
  } catch {
    return undefined;
  }
}

async function detect(): Promise<Detected | null> {
  const ua = navigator.userAgent;
  if (/Web0S|webOS/i.test(ua)) return { platform: 'lg', file: 0 };
  if (/Tizen/i.test(ua)) return { platform: 'samsung', file: 0 };
  if (/AFT[A-Z]|Android TV|GoogleTV|BRAVIA|SHIELD/i.test(ua))
    return { platform: 'android-tv', file: /SHIELD/i.test(ua) ? 1 : 0 };
  if (/Android/i.test(ua)) return { platform: 'android', file: 0 };
  // iPadOS reports itself as a Mac.
  if (
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  )
    return { platform: 'apple', file: 0 };
  if (/Windows/i.test(ua))
    return {
      platform: 'windows',
      file: (await architecture()) === 'arm' ? 1 : 0,
    };
  // Safari doesn't report the architecture, so Apple silicon is the default.
  if (/Macintosh|Mac OS X/i.test(ua))
    return { platform: 'mac', file: (await architecture()) === 'x86' ? 1 : 0 };
  if (/CrOS/i.test(ua)) return null;
  if (/Linux|X11/i.test(ua))
    return {
      platform: 'linux',
      file: (await architecture()) === 'arm' ? 1 : 0,
    };
  return null;
}

/** `ready` turns true even when the platform can't be told. */
export function usePlatform(): { detected: Detected | null; ready: boolean } {
  const [state, setState] = React.useState<{
    detected: Detected | null;
    ready: boolean;
  }>({ detected: null, ready: false });
  React.useEffect(() => {
    let live = true;
    void detect().then((detected) => {
      if (live) setState({ detected, ready: true });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
