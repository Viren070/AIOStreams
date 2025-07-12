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
} from 'lucide-react';
import { FaGithub, FaDiscord } from 'react-icons/fa';
import { BiDonateHeart } from 'react-icons/bi';
import { AiOutlineDiscord } from 'react-icons/ai';
import { FiGithub } from 'react-icons/fi';
import Image from 'next/image';
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Skeleton } from '@/components/ui/skeleton/skeleton';
import { useDisclosure } from '@/hooks/disclosure';
import { Modal } from '../ui/modal';
import { SiGithubsponsors, SiKofi } from 'react-icons/si';
import { useUserData } from '@/context/userData';
import { toast } from 'sonner';
import { useMenu } from '@/context/menu';
import { DonationModal } from '../shared/donation-modal';

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
  const { userData, setUserData } = useUserData();
  const addonName =
    userData.addonName || status?.settings?.addonName || 'AIOStreams';
  const version = status?.tag || 'Unknown';
  const githubUrl = 'https://github.com/Viren070/AIOStreams';
  const releasesUrl = 'https://github.com/Viren070/AIOStreams/releases';
  const stremioGuideUrl = 'https://guides.viren070.me/stremio/';
  const configGuideUrl = 'https://guides.viren070.me/stremio/addons/aiostreams';
  const discordUrl = 'https://discord.viren070.me';
  const donationModal = useDisclosure(false);
  const customizeModal = useDisclosure(false);
  const customHtml = status?.settings?.customHtml;

  return (
    <>
      <div className="flex flex-col gap-4 w-full">
        {/* Top section: Responsive logo/name/about layout */}
        <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-center md:items-start w-full relative">
          {/* Donate button - visible only on larger screens */}
          <div className="hidden lg:block absolute top-0 right-0">
            <Button
              intent="alert-subtle"
              size="md"
              leftIcon={<HeartIcon />}
              onClick={donationModal.open}
            >
              Support Me
            </Button>
          </div>

          {/* Large logo left */}
          <div className="flex-shrink-0 flex justify-center md:justify-start w-full md:w-auto">
            <Image
              src={userData.addonLogo || '/logo.png'}
              alt="Logo"
              width={140}
              height={112}
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
              AIOStreams consolidates multiple Stremio addons and debrid
              services into a single, easily configurable addon. It allows
              highly customisable filtering, sorting, and formatting of results
              and supports proxying all your streams through MediaFlow Proxy or
              StremThru for improved compatibility and IP restriction bypassing.
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

        {/* Main content: Getting Started */}
        <SettingsCard
          title="Get Started"
          description="Everything you need to know about AIOStreams"
          className="mt-4"
        >
          <div className="space-y-6">
            {/* Welcome section */}
            <div className="text-base text-muted-foreground">
              <b>Welcome to AIOStreams!</b> <br />
              <br />
              <span>
                Click the Configure button below to start customizing AIOStreams
                to your preferences. You'll be guided through each section where
                you can set up your configuration. Once complete, you'll create
                a password-protected configuration that you can install in
                Stremio or other compatible apps.
              </span>
              <br />
              <br />
              <span>
                Need to make changes later? Simply click configure within your
                app and enter your password. You can update your settings at any
                time, and in most cases - you won't need to reinstall
                AIOStreams!
              </span>
            </div>

            <div className="flex items-center justify-center mb-6">
              <Button
                intent="white"
                size="lg"
                rounded
                // className="px-8 py-2.5 font-semibold shadow-lg hover:scale-105 transition-transform duration-200"
                onClick={() => {
                  nextMenu();
                }}
              >
                Configure
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
            </div>

            {/* Quick links grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6">
              <a
                href={configGuideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-2 p-4 rounded-lg bg-gray-900/40 hover:bg-gray-900/60 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
              >
                <div className="flex items-center gap-2 text-[--brand] group-hover:underline">
                  <BookOpenIcon className="w-5 h-5" />
                  <span className="font-semibold">Configuration Guide</span>
                </div>
                <p className="text-sm text-muted-foreground group-hover:text-gray-300 transition-colors">
                  Learn how to configure AIOStreams to get the most out of your
                  streaming experience
                </p>
              </a>

              <a
                href="https://github.com/Viren070/AIOStreams/wiki"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-2 p-4 rounded-lg bg-gray-900/40 hover:bg-gray-900/60 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
              >
                <div className="flex items-center gap-2 text-[--brand] group-hover:underline">
                  <BookOpenIcon className="w-5 h-5" />
                  <span className="font-semibold">Wiki</span>
                </div>
                <p className="text-sm text-muted-foreground group-hover:text-gray-300 transition-colors">
                  Browse our comprehensive documentation for advanced features
                  like the Custom Formatter and Group conditions.
                </p>
              </a>

              <a
                href={stremioGuideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-2 p-4 rounded-lg bg-gray-900/40 hover:bg-gray-900/60 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
              >
                <div className="flex items-center gap-2 text-[--brand] group-hover:underline">
                  <InfoIcon className="w-5 h-5" />
                  <span className="font-semibold">Stremio Guide</span>
                </div>
                <p className="text-sm text-muted-foreground group-hover:text-gray-300 transition-colors">
                  New to Stremio and its addons? Go through my Stremio guide to
                  get started!
                </p>
              </a>
            </div>
          </div>
        </SettingsCard>

        {/* What's New section in its own row */}
        <div className="mt-4">
          <ChangelogBox version={version} />
        </div>

        {/* Social & donation row */}
        <div className="flex flex-col items-center mt-4">
          <div className="flex gap-6 flex-wrap items-center justify-center">
            <a
              href={discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Join Discord"
              className="text-gray-400 hover:text-[--brand] transition-colors"
            >
              <AiOutlineDiscord className="w-7 h-7" />
            </a>
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
              className="text-gray-400 hover:text-[--brand] transition-colors"
            >
              <FiGithub className="w-7 h-7" />
            </a>
            <a
              onClick={donationModal.open}
              title="Support me"
              className="text-gray-400 hover:text-[--brand] cursor-pointer transition-colors"
            >
              <CoffeeIcon className="w-7 h-7" />
            </a>
          </div>
          <div className="flex flex-col items-center gap-0.5 mt-4 text-xs text-gray-500">
            <span>Developed by Viren070.</span>
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
      />
    </>
  );
}

function ChangelogBox({ version }: { version: string }) {
  const [loading, setLoading] = React.useState(true);
  const [markdown, setMarkdown] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!version || version.toLowerCase() === 'unknown') {
      setError('No version available.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setMarkdown(null);
    fetch(
      `https://api.github.com/repos/viren070/aiostreams/releases/tags/${version}`
    )
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch changelog');
        return res.json();
      })
      .then((data) => {
        if (!data.body) setError('No changelog found for this version.');
        setMarkdown(data.body);
      })
      .catch((err) => {
        setError('Failed to load changelog.');
      })
      .finally(() => setLoading(false));
  }, [version]);

  return (
    <SettingsCard
      title="What's New"
      description="View the latest changes for this version"
      className="h-full flex flex-col"
    >
      {loading ? (
        <div className="flex-1 flex flex-col w-full h-full gap-6">
          <Skeleton className="h-12 w-full flex-shrink-0" />
          <Skeleton className="flex-1 w-full" />
          <Skeleton className="h-12 w-full flex-shrink-0" />
        </div>
      ) : error ? (
        <div className="text-xs text-muted-foreground">{error}</div>
      ) : markdown ? (
        <div className="prose prose-invert max-w-none text-xs">
          <div className="text-sm">
            <ReactMarkdown>{markdown}</ReactMarkdown>
          </div>
          <a
            href={`https://github.com/Viren070/AIOStreams/releases/tag/${version}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[--brand] hover:underline flex items-center gap-2 mt-2"
          >
            <GithubIcon className="w-4 h-4" />
            View on GitHub
          </a>
        </div>
      ) : null}
    </SettingsCard>
  );
}

function CustomizeModal({
  open,
  onOpenChange,
  currentName,
  currentLogo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  currentLogo: string | undefined;
}) {
  const { userData, setUserData } = useUserData();
  const [name, setName] = useState(currentName);
  const [logo, setLogo] = useState(currentLogo);

  // Update state when props change
  useEffect(() => {
    setName(currentName);
    setLogo(currentLogo);
  }, [currentName, currentLogo]);

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
    }));

    toast.success('Customization saved');
    onOpenChange(false);
  };

  const handleLogoChange = (value: string) => {
    setLogo(value);
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
