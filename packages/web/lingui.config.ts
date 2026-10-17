import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

const SOURCE = 'en-GB';

/** Test languages: longer accented text, and the same laid out right to left. */
const PSEUDO = [
  { locale: 'en-XA', prepend: '[', append: ']', extend: 0.35 },
  { locale: 'ar-XB', rightToLeft: true },
];

// A language is its catalog file, which Weblate adds.
const dir = new URL('./src/locales', import.meta.url);
const added = existsSync(dir)
  ? readdirSync(dir)
      .filter((name) => name.endsWith('.po'))
      .map((name) => name.slice(0, -'.po'.length))
  : [];

export default defineConfig({
  sourceLocale: SOURCE,
  locales: [...new Set([SOURCE, ...PSEUDO.map((p) => p.locale), ...added])],
  pseudoLocale: PSEUDO,
  fallbackLocales: { default: SOURCE },
  catalogs: [{ path: '<rootDir>/src/locales/{locale}', include: ['src'] }],
  format: formatter({ lineNumbers: false }),
});
