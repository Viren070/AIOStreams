import { t } from '@lingui/core/macro';
import type { ComponentType, CSSProperties } from 'react';
import { BiSolidStar } from 'react-icons/bi';
import type { BaseItemDto } from '../lib/types';
import {
  EbertIcon,
  ImdbIcon,
  LetterboxdIcon,
  MalIcon,
  MetacriticIcon,
  PopcornFullIcon,
  PopcornSpilledIcon,
  TmdbIcon,
  TomatoFreshIcon,
  TomatoRottenIcon,
  TraktIcon,
} from './brand-icons';

interface Score {
  source: string;
  value: number;
  scale: number;
}

/** The item's scores, else the community and critic ratings any server sends. */
export function scoresOf(item: BaseItemDto): Score[] {
  const listed = (item as { aiostreams?: { ratings?: Score[] } }).aiostreams
    ?.ratings;
  if (listed?.length) return listed;
  return [
    item.CommunityRating
      ? { source: 'community', value: item.CommunityRating, scale: 10 }
      : null,
    item.CriticRating
      ? { source: 'tomatoes', value: item.CriticRating, scale: 100 }
      : null,
  ].filter((score) => !!score);
}

interface Look {
  name: string;
  icon: ComponentType<{
    className?: string;
    style?: CSSProperties;
    'aria-hidden'?: boolean;
  }>;
  /** For a one-colour icon. */
  color?: string;
  text: (share: number) => string;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;
const outOf = (max: number) => (share: number) => (share * max).toFixed(1);
const stars = (share: number) => {
  const halves = Math.round(share * 8);
  return '★'.repeat(halves >> 1) + (halves % 2 ? '½' : '');
};

/* eslint-disable lingui/no-unlocalized-strings -- product names and colours */

function lookOf(source: string, share: number): Look {
  // Rotten Tomatoes' line between fresh and rotten.
  const fresh = share >= 0.6;
  switch (source) {
    case 'imdb':
      return { name: 'IMDb', icon: ImdbIcon, text: outOf(10) };
    case 'tomatoes':
      return {
        name: 'Rotten Tomatoes',
        icon: fresh ? TomatoFreshIcon : TomatoRottenIcon,
        text: percent,
      };
    case 'tomatoesAudience':
      return {
        name: t`Rotten Tomatoes audience`,
        icon: fresh ? PopcornFullIcon : PopcornSpilledIcon,
        text: percent,
      };
    case 'metacritic':
      return {
        name: 'Metacritic',
        icon: MetacriticIcon,
        text: (s) => String(Math.round(s * 100)),
      };
    case 'letterboxd':
      return {
        name: 'Letterboxd',
        icon: LetterboxdIcon,
        text: outOf(5),
      };
    case 'rogerebert':
      return { name: 'RogerEbert.com', icon: EbertIcon, text: stars };
    case 'trakt':
      return { name: 'Trakt', icon: TraktIcon, text: percent };
    case 'tmdb':
      return {
        name: 'TMDB',
        icon: TmdbIcon,
        text: percent,
      };
    case 'mal':
      return {
        name: 'MyAnimeList',
        icon: MalIcon,
        text: outOf(10),
      };
    default:
      return {
        name: t`Rating`,
        icon: BiSolidStar,
        color: '#facc15',
        text: outOf(10),
      };
  }
}
/* eslint-enable lingui/no-unlocalized-strings */

function ScoreBadge({ score }: { score: Score }) {
  const share = score.value / score.scale;
  const { name, icon: Icon, color, text } = lookOf(score.source, share);
  return (
    <span
      data-ui="score"
      data-source={score.source}
      title={name}
      className="inline-flex items-center gap-1"
    >
      <Icon aria-hidden className="shrink-0 text-[1.2em]" style={{ color }} />
      <span className="sr-only">{name}</span>
      {text(share)}
    </span>
  );
}

export function Scores({ item, max }: { item: BaseItemDto; max?: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {scoresOf(item)
        .slice(0, max)
        .map((score) => (
          <ScoreBadge key={score.source} score={score} />
        ))}
    </span>
  );
}
