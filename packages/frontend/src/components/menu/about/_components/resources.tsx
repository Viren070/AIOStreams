import React from 'react';
import {
  BookOpenIcon,
  InfoIcon,
  HeartIcon,
  ScrollTextIcon,
  RocketIcon,
} from 'lucide-react';
import { AiOutlineDiscord } from 'react-icons/ai';
import { FiGithub } from 'react-icons/fi';
import { FaChevronRight } from 'react-icons/fa';
import { GlowCard } from '@/components/shared/glow-card';
import { cn } from '@/components/ui/core/styling';
import { DOCS_BASE_URL, DOCS_CHANGELOG_URL } from '@/lib/changelog';

interface ResourceRowProps {
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  emphasis?: boolean;
}

function ResourceRow({
  href,
  onClick,
  icon,
  label,
  hint,
  emphasis,
}: ResourceRowProps) {
  const className = cn(
    'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors text-left w-full',
    emphasis ? 'bg-red-500/[0.07] hover:bg-red-400/15' : 'hover:bg-gray-800/70'
  );

  const content = (
    <>
      <span
        className={cn(
          'shrink-0 transition-colors',
          emphasis ? 'text-red-300' : 'text-gray-500 group-hover:text-gray-300'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-200">{label}</span>
        <span className="block text-xs text-gray-500 truncate">{hint}</span>
      </span>
      <FaChevronRight className="w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
    </>
  );

  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {content}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

export function Resources({
  discordUrl,
  githubUrl,
  onDonate,
}: {
  discordUrl: string;
  githubUrl: string;
  onDonate: () => void;
}) {
  return (
    <GlowCard className="p-5">
      <h3 className="text-base font-semibold text-white mb-3">
        Help &amp; resources
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        <ResourceRow
          href={DOCS_BASE_URL}
          icon={<BookOpenIcon className="w-4 h-4" />}
          label="Documentation"
          hint="Every option, explained"
        />
        <ResourceRow
          href={`${DOCS_BASE_URL}/configuration/setup`}
          icon={<RocketIcon className="w-4 h-4" />}
          label="Setup guide"
          hint="Walkthrough for a first install"
        />
        <ResourceRow
          href={DOCS_CHANGELOG_URL}
          icon={<ScrollTextIcon className="w-4 h-4" />}
          label="Changelog"
          hint="What each release added"
        />
        <ResourceRow
          href={discordUrl}
          icon={<AiOutlineDiscord className="w-4 h-4" />}
          label="Discord"
          hint="Ask for help"
        />
        <ResourceRow
          href={githubUrl}
          icon={<FiGithub className="w-4 h-4" />}
          label="GitHub"
          hint="Source and issues"
        />
        <ResourceRow
          onClick={onDonate}
          icon={<HeartIcon className="w-4 h-4" />}
          label="Donate"
          hint="Support development"
          emphasis
        />
      </div>
    </GlowCard>
  );
}
