import { z } from 'zod';
import type { RuntimeConfigSection } from '../types.js';

const stringList = z.array(z.string());

export const screenerSchema = {
  backboneScope: {
    schema: z.boolean(),
    default: true,
    label: 'Screener backbone scope',
    description:
      "Only honour usenet verdicts recorded on a backbone that matches one of this instance's providers, so a release that's dead on another provider's backbone can't hide one that's still fine on yours. Turn off to apply every verdict regardless of backbone.",
    env: 'SCREENER_BACKBONE_SCOPE',
    requiresRestart: false,
    secret: false,
  },
  trustedBackbones: {
    schema: stringList,
    default: [],
    label: 'Screener trusted backbones',
    description:
      "Extra provider root domains (e.g. newshosting.com) whose verdicts are honoured under backbone scope even though they aren't this instance's own — for resellers that share a backbone. Ignored when backbone scope is off.",
    env: 'SCREENER_TRUSTED_BACKBONES',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
