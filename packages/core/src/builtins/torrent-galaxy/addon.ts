import { z } from 'zod';
import { BaseDebridConfigSchema } from '../base/debrid.js';
import { TrbBaseAddon } from '../base/trb.js';
import { TrbSite } from '../base/trb-api.js';
import { config as appConfig } from '../../config/index.js';

export const TorrentGalaxyAddonConfigSchema = BaseDebridConfigSchema;

export type TorrentGalaxyAddonConfig = z.infer<
  typeof TorrentGalaxyAddonConfigSchema
>;

const site: TrbSite = {
  id: 'torrent-galaxy',
  name: 'Torrent Galaxy',
  indexerLabel: 'TGx',
  getConfig: () => appConfig.builtins.torrentGalaxy,
};

export class TorrentGalaxyAddon extends TrbBaseAddon<TorrentGalaxyAddonConfig> {
  constructor(userData: TorrentGalaxyAddonConfig, clientIp?: string) {
    super(userData, TorrentGalaxyAddonConfigSchema, clientIp, site);
  }
}
