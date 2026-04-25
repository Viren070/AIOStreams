import { FormatterContext } from './base.js';
import { BaseFormatter } from './base.js';
import { BUILTIN_FORMATTER_DEFINITIONS } from '../utils/formatter-definitions.js';

export class TorrentioFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(BUILTIN_FORMATTER_DEFINITIONS['torrentio']!, ctx);
  }
}

export class TorboxFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(BUILTIN_FORMATTER_DEFINITIONS['torbox']!, ctx);
  }
}

export class GDriveFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(BUILTIN_FORMATTER_DEFINITIONS['gdrive']!, ctx);
  }
}

export class LightGDriveFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(BUILTIN_FORMATTER_DEFINITIONS['lightgdrive']!, ctx);
  }
}

export class PrismFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(BUILTIN_FORMATTER_DEFINITIONS['prism']!, ctx);
  }
}

export class TamtaroFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(BUILTIN_FORMATTER_DEFINITIONS['tamtaro']!, ctx);
  }
}

export class MinimalisticGdriveFormatter extends BaseFormatter {
  constructor(ctx: FormatterContext) {
    super(BUILTIN_FORMATTER_DEFINITIONS['minimalisticgdrive']!, ctx);
  }
}
