import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { RsbuildPlugin } from '@rsbuild/core';

/** The code's name for the list's file, which the plugin swaps for the real one. */
export const LICENSES_FILE = '__AIOSTREAMS_LICENSES_FILE__';

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-]|$)/i;

interface Library {
  name: string;
  version?: string;
  licence?: string;
  url?: string;
  texts: number[];
}

interface PackageJson {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  homepage?: string;
  repository?: string | { url?: string };
}

/** `<...>/node_modules/<name>` or `<...>/node_modules/@scope/name`, for a file in a package. */
function packageRoot(file: string): string | null {
  const parts = file.split(/[\\/]/);
  const at = parts.lastIndexOf('node_modules');
  if (at < 0 || at + 1 >= parts.length) return null;
  return parts.slice(0, at + (parts[at + 1].startsWith('@') ? 3 : 2)).join('/');
}

function licenceOf(json: PackageJson): string | undefined {
  if (typeof json.license === 'string') return json.license;
  if (json.license?.type) return json.license.type;
  const types = json.licenses?.map((l) => l.type).filter(Boolean);
  return types?.length ? types.join(' OR ') : undefined;
}

function urlOf(json: PackageJson): string | undefined {
  const repository =
    typeof json.repository === 'string'
      ? json.repository
      : json.repository?.url;
  const url =
    json.homepage ??
    repository
      ?.replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/\.git$/, '');
  return url?.startsWith('https://') ? url : undefined;
}

/**
 * Lists the npm packages the bundle holds code from, with their licence texts, as
 * `static/licenses.<hash>.json`, and points the code's `__LICENSES_FILE__` at it.
 */
export const pluginLicenses = (): RsbuildPlugin => ({
  name: 'aiostreams:licenses',
  setup(api) {
    api.processAssets({ stage: 'additional' }, ({ compilation, sources }) => {
      const roots = new Set<string>();
      for (const module of compilation.modules) {
        const resource = (module as { resource?: string }).resource;
        const root = resource && packageRoot(resource.split('?')[0]);
        if (root) roots.add(root);
      }
      const texts: string[] = [];
      const libraries = new Map<string, Library>();
      for (const root of roots) {
        let json: PackageJson;
        try {
          json = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
        } catch {
          continue;
        }
        if (!json.name) continue;
        const key = `${json.name}@${json.version}`;
        if (libraries.has(key)) continue;
        const files = readdirSync(root)
          .filter((f) => LICENCE_FILE.test(f))
          .sort();
        const ids = files.map((f) => {
          const text = readFileSync(`${root}/${f}`, 'utf8').trim();
          const known = texts.indexOf(text);
          return known >= 0 ? known : texts.push(text) - 1;
        });
        libraries.set(key, {
          name: json.name,
          version: json.version,
          licence: licenceOf(json),
          url: urlOf(json),
          texts: ids,
        });
      }
      const list = JSON.stringify({
        texts,
        libraries: [...libraries.values()].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      });
      const hash = createHash('sha256').update(list).digest('hex').slice(0, 8);
      const file = `static/licenses.${hash}.json`;
      compilation.emitAsset(file, new sources.RawSource(list));
      for (const asset of compilation.getAssets()) {
        if (!asset.name.endsWith('.js')) continue;
        const code = asset.source.source().toString();
        if (!code.includes(LICENSES_FILE)) continue;
        const replaced = new sources.ReplaceSource(asset.source);
        for (
          let at = code.indexOf(LICENSES_FILE);
          at >= 0;
          at = code.indexOf(LICENSES_FILE, at + 1)
        )
          replaced.replace(at, at + LICENSES_FILE.length - 1, file);
        compilation.updateAsset(asset.name, replaced);
      }
    });
  },
});
