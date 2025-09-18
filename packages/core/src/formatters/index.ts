export * from './base.js';
export * from './predefined.js';
export * from './custom.js';
export * from './utils.js';

import { BaseFormatter, FormatterConfig } from './base.js';
import {
  TorrentioFormatter,
  TorboxFormatter,
  GDriveFormatter,
  LightGDriveFormatter,
  MinimalisticGdriveFormatter,
} from './predefined.js';
import { CustomFormatter } from './custom.js';
import { UserData } from '../db/schemas.js';

export function createFormatter(userData: UserData): BaseFormatter {
  switch (userData.formatter.id) {
    case 'torrentio':
      return new TorrentioFormatter(userData);
    case 'torbox':
      return new TorboxFormatter(userData);
    case 'gdrive':
      return new GDriveFormatter(userData);
    case 'lightgdrive':
      return new LightGDriveFormatter(userData);
    case 'minimalisticgdrive':
      return new MinimalisticGdriveFormatter(userData);
    case 'custom':
      if (!userData.formatter.definition) {
        throw new Error('Definition is required for custom formatter');
      }
      return CustomFormatter.fromConfig(
        userData.formatter.definition,
        userData
      );
    default:
      throw new Error(`Unknown formatter type: ${userData.formatter.id}`);
  }
}
