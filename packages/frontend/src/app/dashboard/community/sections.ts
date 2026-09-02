import type { ElementType } from 'react';
import { BiBlock, BiGlobe, BiTime } from 'react-icons/bi';

export type CommunitySectionId = 'pending' | 'published' | 'blocks';

export const COMMUNITY_SECTIONS: {
  id: CommunitySectionId;
  label: string;
  icon: ElementType;
}[] = [
  { id: 'pending', label: 'Review queue', icon: BiTime },
  { id: 'published', label: 'Published', icon: BiGlobe },
  { id: 'blocks', label: 'Blocks', icon: BiBlock },
];

export const DEFAULT_COMMUNITY_SECTION: CommunitySectionId = 'pending';
