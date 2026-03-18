export * from './base.js';
export * from './predefined.js';
export * from './custom.js';
export * from './utils.js';

import { BaseFormatter, FormatterConfig, FormatterContext } from './base.js';
import {
  TorrentioFormatter,
  TorboxFormatter,
  GDriveFormatter,
  LightGDriveFormatter,
  MinimalisticGdriveFormatter,
  PrismFormatter,
  TamtaroFormatter,
} from './predefined.js';
import { CustomFormatter } from './custom.js';
import { UserData } from '../db/schemas.js';

export function createFormatter(ctx: FormatterContext): BaseFormatter {
  switch (ctx.userData.formatter.id) {
    case 'torrentio':
      return new TorrentioFormatter(ctx);
    case 'torbox':
      return new TorboxFormatter(ctx);
    case 'gdrive':
      return new GDriveFormatter(ctx);
    case 'lightgdrive':
      return new LightGDriveFormatter(ctx);
    case 'minimalisticgdrive':
      return new MinimalisticGdriveFormatter(ctx);
    case 'prism':
      return new PrismFormatter(ctx);
    case 'tamtaro':
      return new TamtaroFormatter(ctx);
    case 'custom':
      if (!ctx.userData.formatter.definition) {
        throw new Error('Definition is required for custom formatter');
      }
      return CustomFormatter.fromConfig(ctx.userData.formatter.definition, ctx);
    default:
      throw new Error(`Unknown formatter type: ${ctx.userData.formatter.id}`);
  }
}
