'use client';
import { PageWrapper } from '../shared/page-wrapper';
import { useStatus } from '@/context/status';
import { SettingsCard } from '../shared/settings-card';
import { Alert } from '@/components/ui/alert';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import {
  InfoIcon,
  GithubIcon,
  BookOpenIcon,
  HeartIcon,
  CoffeeIcon,
  MessageCircleIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react';
import { FaGithub, FaDiscord, FaChevronRight } from 'react-icons/fa';
import { BiDonateHeart, BiLogInCircle, BiLogOutCircle } from 'react-icons/bi';
import { AiOutlineDiscord } from 'react-icons/ai';
import { FiGithub } from 'react-icons/fi';
import Image from 'next/image';
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Skeleton } from '@/components/ui/skeleton';
import { useDisclosure } from '@/hooks/disclosure';
import { Modal } from '../ui/modal';
import { SiGithubsponsors, SiKofi } from 'react-icons/si';
import { useUserData } from '@/context/userData';
import { toast } from 'sonner';
import { useMenu } from '@/context/menu';
import { useMode } from '@/context/mode';
import { DonationModal } from '../shared/donation-modal';
import { ModeSwitch } from '../ui/mode-switch/mode-switch';
import { ModeSelectModal } from '../shared/mode-select-modal';
import { ConfigModal } from '../config-modal';
import { ConfigTemplatesModal } from '../shared/config-templates-modal';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../shared/confirmation-dialog';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { cn } from '@/components/ui/core/styling';
import { Textarea } from '../ui/textarea';
import { FaPlay } from 'react-icons/fa6';
import { usePathname } from 'next/navigation';

interface QuickLinkProps {
  href?: string;
  onClick?: () => void;
  className?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function QuickLink({
  href,
  onClick,
  icon,
  children,
  className,
}: QuickLinkProps) {
  className = cn(
    'group relative flex flex-col justify-between p-4 h-32 rounded-lg bg-gray-800/60 hover:bg-gray-800/60 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg border border-transparent hover:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:border-white',
    className
  );

  const content = (
    <>
      <div className="text-gray-400 group-hover:text-white transition-colors">
        {icon}
      </div>
      <span className="font-semibold text-gray-400 text-sm font-bold group-hover:text-white transition-colors text-left">
        {children}
      </span>
      <FaChevronRight className="absolute bottom-4 right-4 w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      {content}
    </button>
  );
}

export function AboutMenu() {
  return (
    <>
      <PageWrapper className="space-y-4 p-4 sm:p-8">
        <Content />
      </PageWrapper>
    </>
  );
}

function Content() {
  const { status, loading, error } = useStatus();
  const { nextMenu } = useMenu();
  const [initialUuid, setInitialUuid] = React.useState<string | null>(null);
  const { userData, setUserData, uuid, setUuid, password, setPassword } =
    useUserData();
  const { mode, setMode, isFirstTime } = useMode();
  const modeSelectModal = useDisclosure(isFirstTime);
  const addonName =
    userData.addonName || status?.settings?.addonName || 'AIOStreams';
  const defaultDescription = `
AIOStreams consolidates multiple Stremio addons and debrid services - including its own suite of exclusive built-in addons - into a single, highly customisable super-addon. 
  `;
  const addonDescription = userData.addonDescription || defaultDescription;
  const version = status?.tag || 'Unknown';
  const githubUrl = 'https://github.com/Viren070/AIOStreams';
  const releasesUrl = 'https://github.com/Viren070/AIOStreams/releases';
  const stremioGuideUrl = 'https://guides.viren070.me/stremio/';
  const configGuideUrl = 'https://guides.viren070.me/stremio/addons/aiostreams';
  const discordUrl = 'https://discord.viren070.me';
  const donationModal = useDisclosure(false);
  const customizeModal = useDisclosure(false);
  const signInModal = useDisclosure(false);
  const templatesModal = useDisclosure(false);
  const setupChoiceModal = useDisclosure(false);
  const customHtml = status?.settings?.customHtml;
  const pathname = usePathname();
  const confirmClearConfig = useConfirmationDialog({
    title: 'Sign Out',
    description: 'Are you sure you want to sign out?',
    onConfirm: () => {
      setUserData(null);
      setUuid(null);
      setPassword(null);
    },
  });

  React.useEffect(() => {
    const uuidMatch = pathname.match(
      /stremio\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/.*\/configure/
    );
    if (uuidMatch) {
      setInitialUuid(uuidMatch[1]);
    }
  }, [pathname]);

  return (
    <>
      <div className="flex flex-col gap-4 w-full">
        {/* Top section: Responsive logo/name/about layout */}
        <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-center md:items-start w-full relative">
          {/* Login/Logout button - visible only on larger screens */}
          <div className="hidden lg:block absolute top-0 right-0">
            <Button
              intent="primary-outline"
              size="md"
              iconClass="text-2xl"
              leftIcon={
                uuid && password ? <BiLogOutCircle /> : <BiLogInCircle />
              }
              onClick={() => {
                if (uuid && password) {
                  confirmClearConfig.open();
                } else {
                  signInModal.open();
                }
              }}
            >
              {uuid && password ? 'Sign Out' : 'Sign In'}
            </Button>
          </div>

          {/* Large logo left */}
          <div className="flex-shrink-0 flex justify-center md:justify-start w-full md:w-auto p-2">
            <Image
              src={userData.addonLogo || '/logo.png'}
              alt="Logo"
              width={128}
              height={128}
              className="rounded-lg shadow-lg"
            />
          </div>
          {/* Name, version, about right */}
          <div className="flex flex-col gap-2 w-full">
            <div className="flex flex-col md:flex-row md:items-end md:gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-3xl md:text-4xl font-bold tracking-tight text-gray-100 truncate">
                  {addonName}
                </span>
                <IconButton
                  icon={<PencilIcon className="w-4 h-4" />}
                  intent="primary-subtle"
                  onClick={customizeModal.open}
                  className="rounded-full flex-shrink-0"
                  size="sm"
                />
              </div>
              <span className="text-xl md:text-2xl font-semibold text-gray-400 md:mb-1">
                {version}{' '}
                {/* {version.includes('nightly') ? `(${status?.commit})` : ''} */}
                {version.includes('nightly') ? (
                  <a
                    href={`https://github.com/Viren070/AIOStreams/commit/${status?.commit}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[--brand] hover:underline"
                  >
                    ({status?.commit})
                  </a>
                ) : null}
              </span>
            </div>
            <div className="text-base md:text-lg text-[--muted] font-medium mb-2">
              {addonDescription}
            </div>
          </div>
        </div>

        {/* Custom HTML section, styled like a card, only if present */}
        {customHtml && (
          <SettingsCard>
            <div
              className="[&_a]:text-[--brand] [&_a:hover]:underline"
              dangerouslySetInnerHTML={{ __html: customHtml }}
            />
          </SettingsCard>
        )}

        {/* Setup Mode Row */}
        <div className="flex flex-col items-center md:items-start gap-4 w-full md:pl-6">
          <div className="flex flex-col md:flex-row items-center gap-4 w-full justify-start">
            <div className="flex flex-col items-start md:items-start">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 self-start">
                Setup Mode
              </span>
              <ModeSwitch
                value={mode}
                onChange={setMode}
                className="w-[280px] h-12 text-base"
              />
            </div>
            <div className="text-gray-400 md:self-end md:pb-3">
              <FaChevronRight className="hidden md:block text-2xl" />
              <FaChevronRight className="md:hidden rotate-90 text-2xl" />
            </div>
            <div className="md:self-end">
              <Button
                intent="white"
                rounded
                leftIcon={<FaPlay />}
                className="h-12 px-6 text-lg font-semibold"
                onClick={setupChoiceModal.open}
              >
                {uuid && password ? 'CONTINUE SETUP' : 'START SETUP'}
              </Button>
            </div>
          </div>

          {/* Template Wizard Link */}
          <div className="text-center md:text-left text-sm text-gray-400 max-w-2xl">
            New to AIOStreams? Try our{' '}
            <button
              onClick={templatesModal.open}
              className="text-[--brand] hover:text-[--brand]/80 hover:underline font-medium"
            >
              Template Wizard
            </button>{' '}
            for a guided, step-by-step setup experience with pre-configured
            settings.
          </div>
        </div>

        {/* Main content: Get Started and What's New sections */}
        <div className="flex flex-col lg:flex-row gap-8 mt-4">
          {/* Get Started section */}
          <div className="flex-1">
            <div className="p-6 h-full flex flex-col">
              <div className="mb-4">
                <h3 className="text-2xl font-semibold text-white mb-1">
                  Welcome to AIOStreams!
                </h3>
              </div>

              <div className="space-y-6 flex-1">
                {/* Welcome section */}
                <div className="text-base text-muted-foreground">
                  <span>
                    Click the Start Setup button above to start customising
                    AIOStreams to your preferences. You'll be guided through
                    each section where you can set up your configuration. Once
                    complete, you'll create a password-protected configuration
                    that you can install in Stremio or other compatible apps.
                  </span>
                  <br />
                  <br />
                  <span>
                    Need to make changes later? Simply click configure within
                    your app and enter your password. You can update your
                    settings at any time, and in most cases - you won't need to
                    reinstall AIOStreams!
                  </span>
                  <br />
                  <br />
                  <span>
                    Got an existing configuration already? Click the login
                    button in the top right corner to access it.
                  </span>
                </div>

                <div className="relative">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
                </div>

                {/* Quick links grid */}
                <div className="pt-6">
                  <h4 className="text-xl font-semibold text-white mb-4">
                    Resources & Support
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <QuickLink
                      href={configGuideUrl}
                      icon={<BookOpenIcon className="w-8 h-8" />}
                    >
                      Configuration Guide
                    </QuickLink>
                    <QuickLink
                      href="https://github.com/Viren070/AIOStreams/wiki"
                      icon={<BookOpenIcon className="w-8 h-8" />}
                    >
                      Wiki
                    </QuickLink>
                    <QuickLink
                      href={stremioGuideUrl}
                      icon={<InfoIcon className="w-8 h-8" />}
                    >
                      Stremio Guide
                    </QuickLink>
                    <QuickLink
                      href={discordUrl}
                      icon={<AiOutlineDiscord className="w-8 h-8" />}
                    >
                      Discord
                    </QuickLink>
                    <QuickLink
                      href={githubUrl}
                      icon={<FiGithub className="w-8 h-8" />}
                    >
                      GitHub
                    </QuickLink>
                    <QuickLink
                      onClick={donationModal.open}
                      icon={<HeartIcon className="w-8 h-8" />}
                      className="bg-gradient-to-br from-red-500/20 to-pink-500/20 hover:from-red-500/30 hover:to-pink-500/30 border-red-400/30 hover:border-red-400/50"
                    >
                      Donate
                    </QuickLink>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* What's New section */}
          <div className="flex-[1.5]">
            <ChangelogBox version={version} />
          </div>
        </div>

        {/* Social & donation row */}
        <div className="flex flex-col items-center mt-4">
          <div className="flex flex-col items-center gap-0.5 mt-4 text-xs text-gray-500">
            <span>
              © {new Date().getFullYear()} AIOStreams. Developed by Viren070.
            </span>
            <span>
              This beautiful UI would not be possible without{' '}
              <a
                href="https://seanime.rahim.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                Seanime
              </a>
            </span>
          </div>
        </div>
      </div>
      <DonationModal
        open={donationModal.isOpen}
        onOpenChange={donationModal.toggle}
      />
      <CustomizeModal
        open={customizeModal.isOpen}
        onOpenChange={customizeModal.toggle}
        currentName={addonName}
        currentLogo={userData.addonLogo}
        currentDescription={userData.addonDescription}
      />
      <ModeSelectModal
        open={modeSelectModal.isOpen}
        onOpenChange={modeSelectModal.toggle}
      />
      <ConfigModal
        open={signInModal.isOpen}
        onSuccess={() => {
          signInModal.close();
          toast.success('Signed in successfully');
        }}
        onOpenChange={(v) => {
          if (!v) {
            signInModal.close();
          }
        }}
        initialUuid={initialUuid || undefined}
      />
      <ConfirmationDialog {...confirmClearConfig} />
      <ConfigTemplatesModal
        open={templatesModal.isOpen}
        onOpenChange={templatesModal.toggle}
      />
      <SetupChoiceModal
        open={setupChoiceModal.isOpen}
        onOpenChange={setupChoiceModal.toggle}
        onNextMenu={() => {
          setupChoiceModal.close();
          nextMenu();
        }}
        onUseTemplate={() => {
          setupChoiceModal.close();
          templatesModal.open();
        }}
        nextMenuText={uuid && password ? 'Continue Setup' : 'Start Fresh'}
        nextMenuDescription={
          uuid && password
            ? 'Continue adjusting your setup'
            : 'Build your configuration from scratch. Perfect if you want complete control over every setting.'
        }
        useTemplateText="Use a Template"
        useTemplateDescription={
          uuid && password
            ? 'Apply a template to your existing setup'
            : 'Start with a pre-configured template. Great for getting up and running quickly with recommended settings.'
        }
      />
    </>
  );
}

function ChangelogBox({ version }: { version: string }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [allReleases, setAllReleases] = React.useState<any[]>([]);
  const [currentReleases, setCurrentReleases] = React.useState<any[]>([]);
  const [newerReleases, setNewerReleases] = React.useState<any[]>([]);
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [showUpdates, setShowUpdates] = React.useState(false);
  const [hasMorePages, setHasMorePages] = React.useState(true);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [fetchingMore, setFetchingMore] = React.useState(false);
  const [showLoadMoreOverlay, setShowLoadMoreOverlay] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Determine channel from version
  const currentChannel = React.useMemo(() => {
    return version.startsWith('v') ? 'stable' : 'nightly';
  }, [version]);

  // Version comparison function
  const compareVersions = React.useCallback(
    (releaseVersion: string, currentVersion: string) => {
      if (currentChannel === 'stable') {
        // For stable versions, compare semver (e.g., v2.5.1 vs v2.5.2)
        const releaseV = releaseVersion.replace('v', '').split('.').map(Number);
        const currentV = currentVersion.replace('v', '').split('.').map(Number);

        for (let i = 0; i < Math.max(releaseV.length, currentV.length); i++) {
          const r = releaseV[i] || 0;
          const c = currentV[i] || 0;
          if (r > c) return 1; // release is newer
          if (r < c) return -1; // release is older
        }
        return 0; // same version
      } else {
        // For nightly versions, compare date-time (e.g., 2024.01.01.1200-nightly)
        const releaseDate = releaseVersion.replace('-nightly', '');
        const currentDate = currentVersion.replace('-nightly', '');

        if (releaseDate > currentDate) return 1; // release is newer
        if (releaseDate < currentDate) return -1; // release is older
        return 0; // same version
      }
    },
    [currentChannel]
  );

  // Fetch releases with pagination
  const fetchReleases = React.useCallback(async (page: number = 1) => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/viren070/aiostreams/releases?per_page=100&page=${page}`
      );

      if (!response.ok) throw new Error('Failed to fetch releases');

      const newReleases = await response.json();

      // Check if there are more pages
      const linkHeader = response.headers.get('link');
      const hasNextPage = linkHeader && linkHeader.includes('rel="next"');
      setHasMorePages(!!hasNextPage);

      return newReleases;
    } catch (error) {
      throw error;
    }
  }, []);

  // Filter releases by channel
  const filterReleasesByChannel = React.useCallback(
    (releases: any[], channel: 'stable' | 'nightly') => {
      if (channel === 'stable') {
        return releases.filter(
          (r: any) =>
            r.tag_name.startsWith('v') && !r.tag_name.includes('nightly')
        );
      } else {
        return releases.filter((r: any) => r.tag_name.endsWith('-nightly'));
      }
    },
    []
  );

  // Initial fetch and setup
  React.useEffect(() => {
    if (!version || version.toLowerCase() === 'unknown') {
      setError('No version available.');
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);
    setAllReleases([]);
    setCurrentReleases([]);
    setNewerReleases([]);
    setVisibleCount(0);
    setCurrentPage(1);
    setHasMorePages(true);
    setShowUpdates(false);

    // Fetch initial releases
    fetchReleases(1)
      .then((releases) => {
        // Filter by current channel
        const filtered = filterReleasesByChannel(releases, currentChannel);

        // Sort by published date descending
        filtered.sort(
          (a, b) =>
            new Date(b.published_at).getTime() -
            new Date(a.published_at).getTime()
        );

        setAllReleases(filtered);

        // Split releases based on current version
        const newer: any[] = [];
        const currentAndOlder: any[] = [];

        filtered.forEach((release) => {
          const comparison = compareVersions(release.tag_name, version);
          if (comparison > 0) {
            newer.push(release);
          } else {
            currentAndOlder.push(release);
          }
        });

        setNewerReleases(newer);
        setCurrentReleases(currentAndOlder);
        setVisibleCount(Math.min(5, currentAndOlder.length));
      })
      .catch(() => setError('Failed to load changelogs.'))
      .finally(() => setLoading(false));
  }, [
    version,
    currentChannel,
    fetchReleases,
    filterReleasesByChannel,
    compareVersions,
  ]);

  // Function to fetch more releases when needed
  const fetchMoreReleases = React.useCallback(async () => {
    if (!hasMorePages || fetchingMore) return;

    setFetchingMore(true);
    try {
      const nextPage = currentPage + 1;
      const newReleases = await fetchReleases(nextPage);

      // Filter the new releases by current channel
      const filtered = filterReleasesByChannel(newReleases, currentChannel);

      if (filtered.length > 0) {
        // Sort by published date descending
        filtered.sort(
          (a, b) =>
            new Date(b.published_at).getTime() -
            new Date(a.published_at).getTime()
        );

        // Add to all releases
        setAllReleases((prev) => [...prev, ...filtered]);

        // Split new releases based on current version
        const newer: any[] = [];
        const currentAndOlder: any[] = [];

        filtered.forEach((release) => {
          const comparison = compareVersions(release.tag_name, version);
          if (comparison > 0) {
            newer.push(release);
          } else {
            currentAndOlder.push(release);
          }
        });

        setNewerReleases((prev) => [...prev, ...newer]);
        setCurrentReleases((prev) => [...prev, ...currentAndOlder]);
        setCurrentPage(nextPage);
      }
    } catch (error) {
      console.error('Failed to fetch more releases:', error);
    } finally {
      setFetchingMore(false);
    }
  }, [
    hasMorePages,
    fetchingMore,
    currentPage,
    fetchReleases,
    currentChannel,
    filterReleasesByChannel,
    compareVersions,
    version,
  ]);

  // Get the releases to display
  const displayReleases = React.useMemo(() => {
    if (showUpdates) {
      return [...newerReleases, ...currentReleases];
    }
    return currentReleases;
  }, [showUpdates, newerReleases, currentReleases]);

  // Show/hide load more overlay based on scroll position
  React.useEffect(() => {
    const handleScroll = () => {
      const container = containerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

      const hasMoreContent =
        displayReleases.length > visibleCount || // More releases in memory
        (hasMorePages && !fetchingMore); // More pages to fetch

      setShowLoadMoreOverlay(isNearBottom && hasMoreContent && !loading);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      // Check on mount and when dependencies change
      handleScroll();
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [
    visibleCount,
    displayReleases.length,
    hasMorePages,
    fetchingMore,
    loading,
  ]);

  const handleLoadMore = () => {
    if (displayReleases.length > visibleCount) {
      // Load more from current releases
      setVisibleCount((prev) => Math.min(prev + 5, displayReleases.length));
      // Check if we need to fetch more after increasing visible count
      if (displayReleases.length <= visibleCount + 5 && hasMorePages) {
        fetchMoreReleases();
      }
    } else if (hasMorePages && !fetchingMore) {
      // Fetch more releases from API
      fetchMoreReleases();
    }
  };

  const handleShowUpdates = () => {
    setShowUpdates(true);
    setVisibleCount(Math.min(5, newerReleases.length + currentReleases.length));
  };

  const hasMoreContent =
    displayReleases.length > visibleCount || (hasMorePages && !fetchingMore);

  // Check if a release is newer than current version
  const isNewerVersion = React.useCallback(
    (releaseVersion: string) => {
      return compareVersions(releaseVersion, version) > 0;
    },
    [compareVersions, version]
  );

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-2xl font-semibold text-white">What's New?</h3>
        {newerReleases.length > 0 && (
          <span className="text-[#c8af48] font-bold text-sm">
            {newerReleases.length} update
            {newerReleases.length > 1 ? 's' : ''} available
          </span>
        )}
      </div>
      <div className="relative flex-1" style={{ minHeight: '400px' }}>
        <div
          ref={containerRef}
          className="changelog-container absolute inset-0 pr-2"
          style={{
            overflowY: 'auto',
          }}
        >
          {loading ? (
            <div className="p-4 space-y-4">
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-4">
              <Alert intent="alert" title="Error" description={error} />
            </div>
          ) : displayReleases.length === 0 ? (
            <div className="p-4">
              <Alert
                intent="info"
                title="No changelogs found"
                description={`No ${currentChannel} changelogs available.`}
              />
            </div>
          ) : (
            <div className="relative min-h-full p-4 space-y-4">
              {/* Show updates button */}
              {newerReleases.length > 0 && !showUpdates && (
                <div className="flex justify-center mb-4">
                  <Button
                    intent="primary-outline"
                    size="sm"
                    onClick={handleShowUpdates}
                  >
                    Show {newerReleases.length} available update
                    {newerReleases.length > 1 ? 's' : ''}
                  </Button>
                </div>
              )}

              {displayReleases.slice(0, visibleCount).map((release, idx) => (
                <Card
                  key={release.id || release.tag_name}
                  className={cn(
                    'border bg-gray-800/60 border-gray-800 relative',
                    isNewerVersion(release.tag_name) && 'border-[#c8af48]/30'
                  )}
                >
                  <CardHeader className="pb-2">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={cn(
                            'text-sm sm:text-base font-semibold break-all',
                            isNewerVersion(release.tag_name)
                              ? 'text-[#c8af48]' // c8af48
                              : 'text-[--brand]'
                          )}
                        >
                          {release.tag_name}
                        </span>
                      </div>
                      <div className="flex-shrink-0">
                        <span className="text-xs text-gray-400">
                          {new Date(release.published_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="prose prose-invert prose-sm max-w-none [&_p]:text-sm [&_ul]:text-sm [&_li]:text-sm [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_*]:break-all">
                    <ReactMarkdown>
                      {release.body
                        ? release.body.replace(release.tag_name, '')
                        : 'No changelog provided.'}
                    </ReactMarkdown>
                  </CardContent>
                  <CardFooter>
                    <a
                      href={release.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:underline flex items-center justify-between w-full text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <FaGithub className="w-4 h-4" />
                        View on GitHub
                      </span>
                      <FaChevronRight className="w-4 h-4" />
                    </a>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Load More Overlay */}
        {showLoadMoreOverlay && hasMoreContent && (
          <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none opacity-0 transition-opacity duration-300 ease-in-out"
            style={{
              height: '96px',
              opacity: showLoadMoreOverlay ? 1 : 0,
            }}
          >
            <div className="h-full flex items-end justify-center pb-4">
              <div
                className="flex flex-col items-center gap-2 pointer-events-auto opacity-0 translate-y-4 transition-all duration-300 ease-in-out"
                style={{
                  opacity: showLoadMoreOverlay ? 1 : 0,
                  transform: showLoadMoreOverlay
                    ? 'translateY(0)'
                    : 'translateY(1rem)',
                }}
              >
                <span className="text-sm font-medium text-white/90">
                  {fetchingMore
                    ? 'Loading...'
                    : displayReleases.length > visibleCount
                      ? `Load ${Math.min(5, displayReleases.length - visibleCount)} more`
                      : 'Load more releases'}
                </span>
                <button
                  onClick={handleLoadMore}
                  disabled={fetchingMore}
                  className="group flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fetchingMore ? (
                    <div className="w-5 h-5 border-2 border-white/60 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <svg
                      className="w-6 h-6 text-white/80 group-hover:text-white transition-colors"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 14l-7 7m0 0l-7-7m7 7V3"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomizeModal({
  open,
  onOpenChange,
  currentName,
  currentLogo,
  currentDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  currentLogo: string | undefined;
  currentDescription: string | undefined;
}) {
  const { userData, setUserData } = useUserData();
  const [name, setName] = useState(currentName);
  const [logo, setLogo] = useState(currentLogo);
  const [description, setDescription] = useState(currentDescription);
  // Update state when props change
  useEffect(() => {
    setName(currentName);
    setLogo(currentLogo);
    setDescription(currentDescription);
  }, [currentName, currentLogo, currentDescription]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name cannot be empty');
      return;
    }

    setUserData((prev) => ({
      ...prev,
      addonName: name.trim(),
      addonLogo: logo?.trim(),
      addonDescription: description?.trim() || undefined,
    }));

    toast.success('Customization saved');
    onOpenChange(false);
  };

  const handleLogoChange = (value: string) => {
    setLogo(value.trim() || undefined);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Customize Addon">
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <TextInput
              label="Addon Name"
              value={name}
              onValueChange={setName}
              placeholder="Enter addon name"
            />
            <p className="text-xs text-[--muted]">
              This name will be displayed in Stremio
            </p>
          </div>

          <div className="space-y-2">
            <TextInput
              label="Logo URL"
              value={logo}
              onValueChange={handleLogoChange}
              placeholder="Enter logo URL"
              type="url"
            />
            <p className="text-xs text-[--muted]">
              Enter a valid URL for your addon's logo image. Leave blank for
              default logo.
            </p>
          </div>

          <div className="space-y-2">
            <Textarea
              label="Addon Description"
              value={description}
              onValueChange={setDescription}
              placeholder="Enter addon description"
              rows={3}
            />
            <p className="text-xs text-[--muted]">
              This description will be displayed in Stremio
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button
              intent="primary-outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" intent="primary">
              Save Changes
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function SetupChoiceModal({
  open,
  onOpenChange,
  onNextMenu,
  onUseTemplate,
  nextMenuText,
  nextMenuDescription,
  useTemplateText,
  useTemplateDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNextMenu: () => void;
  onUseTemplate: () => void;
  nextMenuText: string;
  nextMenuDescription: string;
  useTemplateText: string;
  useTemplateDescription: string;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Get Started"
      description="Choose how you'd like to set up AIOStreams"
    >
      <div className="space-y-4">
        <button
          onClick={onNextMenu}
          className="w-full p-6 rounded-lg border-2 border-gray-700 bg-gray-800/50 hover:border-purple-500 hover:bg-purple-500/10 transition-all duration-200 text-left group"
        >
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
              <FaPlay className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-2">
                {nextMenuText}
              </h3>
              <p className="text-sm text-gray-400">
                {/* Build your configuration from scratch. Perfect if you want
                complete control over every setting. */}
                {nextMenuDescription}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={onUseTemplate}
          className="w-full p-6 rounded-lg border-2 border-gray-700 bg-gray-800/50 hover:border-blue-500 hover:bg-blue-500/10 transition-all duration-200 text-left group"
        >
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
              <PlusIcon className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-2">
                {useTemplateText}
              </h3>
              <p className="text-sm text-gray-400">
                {/* Start with a pre-configured template. Great for getting up and
                running quickly with recommended settings. */}
                {useTemplateDescription}
              </p>
            </div>
          </div>
        </button>
      </div>
    </Modal>
  );
}
