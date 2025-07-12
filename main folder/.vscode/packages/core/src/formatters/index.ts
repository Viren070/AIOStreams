export * from './base';
export * from './predefined';
export * from './custom';
export * from './utils';

import { BaseFormatter, FormatterConfig } from './base';
import {
  TorrentioFormatter,
  TorboxFormatter,
  GDriveFormatter,
  LightGDriveFormatter,
  MinimalisticGdriveFormatter,
} from './predefined';
import { CustomFormatter } from './custom';
import { FormatterType } from '../utils/constants';

export function createFormatter(
  type: FormatterType,
  config?: FormatterConfig,
  addonName?: string
): BaseFormatter {
  switch (type) {
    case 'torrentio':
      return new TorrentioFormatter(addonName);
    case 'torbox':
      return new TorboxFormatter(addonName);
    case 'gdrive':
      return new GDriveFormatter(addonName);
    case 'lightgdrive':
      return new LightGDriveFormatter(addonName);
    case 'minimalisticgdrive':
      return new MinimalisticGdriveFormatter(addonName);
    case 'custom':
      if (!config) {
        throw new Error('Config is required for custom formatter');
      }
      return CustomFormatter.fromConfig(config, addonName);
    default:
      throw new Error(`Unknown formatter type: ${type}`);
  }
}
