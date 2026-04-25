export * from './base.js';
export * from './predefined.js';
export * from './custom.js';
export * from './utils.js';

import { BaseFormatter, FormatterContext } from './base.js';
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

export function createFormatter(ctx: FormatterContext): BaseFormatter {
  const { formatter } = ctx.userData;

  if (formatter.id === 'custom') {
    if (!formatter?.definitions?.custom) {
      throw new Error('Definition is required for custom formatter');
    }
    return CustomFormatter.fromConfig(formatter.definitions.custom, ctx);
  }

  // A per-formatter override replaces the built-in template while keeping the id.
  const perIdOverride = formatter?.definitions?.overrides?.[formatter.id];
  if (perIdOverride) {
    return CustomFormatter.fromConfig(perIdOverride, ctx);
  }

  switch (formatter.id) {
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
    default:
      throw new Error(`Unknown formatter type: ${formatter.id}`);
  }
}
