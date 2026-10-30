import { z } from 'zod';
import { BaseDebridConfigSchema } from '../base/debrid.js';
import { TrbBaseAddon } from '../base/trb.js';
import { TrbSite } from '../base/trb-api.js';
import { config as appConfig } from '../../config/index.js';

export const TheRARBGAddonConfigSchema = BaseDebridConfigSchema;

export type TheRARBGAddonConfig = z.infer<typeof TheRARBGAddonConfigSchema>;

const site: TrbSite = {
  id: 'therarbg',
  name: 'TheRARBG',
  indexerLabel: 'TheRARBG',
  getConfig: () => appConfig.builtins.therarbg,
};

export class TheRARBGAddon extends TrbBaseAddon<TheRARBGAddonConfig> {
  constructor(userData: TheRARBGAddonConfig, clientIp?: string) {
    super(userData, TheRARBGAddonConfigSchema, clientIp, site);
  }
}
