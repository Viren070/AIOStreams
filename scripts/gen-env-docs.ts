/**
 * Generates the runtime-config portion of the environment-variable reference
 * doc directly from the live config schemas, so the doc can never drift from
 * `packages/core/src/config/schema/*`.
 *
 * Output is written between the marker comments in
 * `packages/docs/content/docs/configuration/environment-variables.mdx`. Content
 * above/below the markers (the hand-written intro, the bootstrap table, etc.) is
 * preserved verbatim.
 *
 * Wired into the docs build via the root `gen:env-docs` script. Run manually
 * with: `pnpm run gen:env-docs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The config index pulls in `bootstrap` -> `env.ts`, whose envalid schema
// requires BASE_URL and SECRET_KEY. We only need the static schema objects, so
// satisfy the validator with throwaway values before importing.
process.env.BASE_URL ??= 'http://localhost:3000';
process.env.SECRET_KEY ??=
  '0000000000000000000000000000000000000000000000000000000000000000';

const { runtimeSchemas, describeSettings } =
  await import('../packages/core/src/config/index.js');
const { isRuntimeConfigField, resolveDescription } =
  await import('../packages/core/src/config/types.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.resolve(
  __dirname,
  '../packages/docs/content/docs/configuration/environment-variables.mdx'
);
const BEGIN = '{/* BEGIN GENERATED ENV REFERENCE */}';
const END = '{/* END GENERATED ENV REFERENCE */}';

/**
 * Mirrors `packages/frontend/src/app/dashboard/settings/tabs.config.ts` so the
 * generated doc is grouped/ordered/labelled the same way as the dashboard
 * Settings UI. Keep in sync if the tab manifest changes.
 */
const TAB_MANIFEST: Record<
  string,
  { label: string; group: string; order: number }
> = {
  api: { label: 'General', group: 'Core', order: 1 },
  branding: { label: 'Branding', group: 'Core', order: 2 },
  templates: { label: 'Templates', group: 'Core', order: 3 },
  metadata: { label: 'Metadata', group: 'Core', order: 4 },
  logging: { label: 'Logging', group: 'Core', order: 5 },
  http: { label: 'HTTP', group: 'Network', order: 6 },
  proxy: { label: 'Proxy', group: 'Network', order: 7 },
  nzbProxy: { label: 'NZB Proxy', group: 'Network', order: 8 },
  rateLimits: { label: 'Rate Limits', group: 'Network', order: 9 },
  services: { label: 'Services', group: 'Content', order: 10 },
  presets: { label: 'Presets', group: 'Content', order: 11 },
  builtins: { label: 'Built-ins', group: 'Content', order: 12 },
  poster: { label: 'Posters', group: 'Content', order: 13 },
  resources: { label: 'Resources', group: 'Content', order: 14 },
  userLimits: { label: 'User Limits', group: 'Limits', order: 15 },
  recursion: { label: 'Recursion', group: 'Limits', order: 16 },
  tasks: { label: 'Tasks', group: 'Limits', order: 17 },
};
const GROUP_ORDER = ['Core', 'Network', 'Content', 'Limits', 'Other'];

const ACRONYMS: Record<string, string> = {
  api: 'API',
  url: 'URL',
  uri: 'URI',
  id: 'ID',
  ip: 'IP',
  ui: 'UI',
  sel: 'SEL',
  http: 'HTTP',
  https: 'HTTPS',
  nzb: 'NZB',
  tmdb: 'TMDB',
  tvdb: 'TVDB',
  rpdb: 'RPDB',
  oauth: 'OAuth',
  gdrive: 'GDrive',
  ttl: 'TTL',
  nab: 'NAB',
  db: 'DB',
};

function humanise(s: string): string {
  if (!s) return '';
  const tokens = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(Boolean);
  return tokens
    .map((t) => {
      const lower = t.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function tabFor(section: string) {
  return (
    TAB_MANIFEST[section] ?? {
      label: humanise(section),
      group: 'Other',
      order: 999,
    }
  );
}

interface Leaf {
  /** Path segments within the section (excludes the section name). */
  sub: string[];
  field: any;
}

function collect(node: Record<string, any>, sub: string[], out: Leaf[]) {
  for (const [name, child] of Object.entries(node)) {
    const childSub = [...sub, name];
    if (isRuntimeConfigField(child)) {
      out.push({ sub: childSub, field: child });
    } else {
      collect(child as Record<string, any>, childSub, out);
    }
  }
}

// MDX parses `{` as an expression and `<` as JSX inside table cells, and `|`
// terminates a cell. Plain markdown backslash-escaping does not work in MDX, so
// neutralise the significant characters with HTML entities — but ONLY outside
// inline-code spans. MDX keeps inline code literal (no JSX/expression parsing
// and no entity decoding), so escaping inside backticks would render the raw
// entity text. Within code we still neutralise `|` since it breaks the table.
function mdEscape(s: string): string {
  const oneLine = s.replace(/\r?\n/g, ' ').trim();
  return oneLine
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return part.replace(/\|/g, '\\|');
      }
      return part
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '&#123;')
        .replace(/\}/g, '&#125;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    })
    .join('');
}

function fmtDefault(field: any): string {
  if (field.secret) return '*(unset)*';
  const d = field.default;
  if (d === null || d === undefined || d === '') return '—';
  if (typeof d === 'string') return '`' + d + '`';
  if (typeof d === 'boolean' || typeof d === 'number') return '`' + d + '`';
  const json = JSON.stringify(d);
  if (json === '{}' || json === '[]') return '—';
  return '`' + json + '`';
}

function main() {
  const hints = describeSettings();

  // Build: group -> section -> rows
  const sections = Object.entries(runtimeSchemas as Record<string, any>)
    .map(([section, tree]) => {
      const leaves: Leaf[] = [];
      collect(tree, [], leaves);
      return { section, tree, leaves, tab: tabFor(section) };
    })
    .sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.tab.group);
      const gb = GROUP_ORDER.indexOf(b.tab.group);
      if (ga !== gb) return ga - gb;
      if (a.tab.order !== b.tab.order) return a.tab.order - b.tab.order;
      return a.section.localeCompare(b.section);
    });

  const lines: string[] = [];
  lines.push(
    '{/* This section is auto-generated by scripts/gen-env-docs.ts from the',
    '    config schemas. Do not edit by hand — run `pnpm run gen:env-docs`. */}',
    ''
  );

  let currentGroup = '';
  for (const { section, leaves, tab } of sections) {
    if (leaves.length === 0) continue;
    if (tab.group !== currentGroup) {
      currentGroup = tab.group;
      lines.push(`## ${currentGroup}`, '');
    }
    lines.push(`### ${tab.label}`, '');

    // Group leaves by their immediate subsection (first sub segment when the
    // field is nested; "" for top-level fields).
    const bySub = new Map<string, Leaf[]>();
    for (const leaf of leaves) {
      const key = leaf.sub.length > 1 ? leaf.sub[0] : '';
      if (!bySub.has(key)) bySub.set(key, []);
      bySub.get(key)!.push(leaf);
    }

    const renderTable = (rows: Leaf[]) => {
      lines.push(
        '| Environment Variable | UI Setting | Type | Default | Description |',
        '| --- | --- | --- | --- | --- |'
      );
      for (const { sub, field } of rows) {
        const key = `${section}.${sub.join('.')}`;
        const hint = hints[key];
        const kind = hint?.kind ?? 'string';
        const flags: string[] = [];
        if (field.secret) flags.push('secret');
        if (field.requiresRestart) flags.push('restart required');
        let desc = mdEscape(resolveDescription(field.description, 'env'));
        if (flags.length) desc += ` _(${flags.join(', ')})_`;
        const envName = Array.isArray(field.env)
          ? field.env[0]
          : field.env
            ? field.env
            : null;
        const envVar = envName ? '`' + envName + '`' : '—';
        const uiLabel = sub.map(humanise).join(' › ');
        lines.push(
          `| ${envVar} | ${uiLabel} | ${kind} | ${fmtDefault(field)} | ${desc} |`
        );
      }
      lines.push('');
    };

    const top = bySub.get('') ?? [];
    if (top.length) renderTable(top);

    for (const [subKey, rows] of bySub) {
      if (subKey === '') continue;
      lines.push(`#### ${humanise(subKey)}`, '');
      renderTable(rows);
    }
  }

  const generated = lines.join('\n').trimEnd();

  const doc = readFileSync(DOC_PATH, 'utf8');
  const bi = doc.indexOf(BEGIN);
  const ei = doc.indexOf(END);
  if (bi === -1 || ei === -1 || ei < bi) {
    throw new Error(
      `Could not find generation markers in ${DOC_PATH}. Expected:\n${BEGIN}\n...\n${END}`
    );
  }
  const before = doc.slice(0, bi + BEGIN.length);
  const after = doc.slice(ei);
  const next = `${before}\n\n${generated}\n\n${after}`;
  if (next !== doc) {
    writeFileSync(DOC_PATH, next);
    console.log(`Updated ${path.relative(process.cwd(), DOC_PATH)}`);
  } else {
    console.log('Env reference already up to date.');
  }
}

main();
