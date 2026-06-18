import type { ElementType } from 'react';
import {
  BiLibrary,
  BiMoviePlay,
  BiBarChartAlt2,
  BiServer,
  BiCog,
} from 'react-icons/bi';

/** The usenet dashboard's sub-sections, shared by the page, the URL search
 *  param validator (router) and the sidebar hover flyout. */
export type SectionId =
  | 'library'
  | 'streams'
  | 'stats'
  | 'providers'
  | 'settings';

export const SECTIONS: { id: SectionId; label: string; icon: ElementType }[] = [
  { id: 'library', label: 'Library', icon: BiLibrary },
  { id: 'streams', label: 'Streams', icon: BiMoviePlay },
  { id: 'stats', label: 'Stats', icon: BiBarChartAlt2 },
  { id: 'providers', label: 'Providers', icon: BiServer },
  { id: 'settings', label: 'Settings', icon: BiCog },
];

export const DEFAULT_SECTION: SectionId = 'library';
