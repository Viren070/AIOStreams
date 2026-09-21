export * from './base.js';
export * from './predefined.js';
export * from './custom.js';
export * from './utils.js';
export {
  validateTemplate,
  type Diagnostic as TemplateDiagnostic,
} from './engine/parser.js';

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
    const definition =
      (formatter.selectedSaved &&
        formatter.definitions?.saved?.[formatter.selectedSaved]) ||
      formatter.definitions?.custom;
    if (!definition) {
      throw new Error('Definition is required for custom formatter');
    }
    return CustomFormatter.fromConfig(definition, ctx);
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
