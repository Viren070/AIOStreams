import { appBridge, ask } from './hosts/shell/bridge';

/** A library the app is made with, and which of its list's texts are its licence. */
export interface Library {
  name: string;
  version?: string;
  /** Its SPDX expression, where it gives one. */
  licence?: string;
  url?: string;
  texts: number[];
}

export interface LicenseList {
  /** Each distinct licence text once. */
  texts: string[];
  libraries: Library[];
}

const byName = new Intl.Collator(undefined, { sensitivity: 'base' });

/** The bundle's npm packages, and in the apps what the app around the page ships. */
export async function loadLicenses(): Promise<LicenseList> {
  const [web, app] = await Promise.all([
    fetch(__webpack_public_path__ + __LICENSES_FILE__).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<LicenseList>;
    }),
    appBridge()
      ? ask({ type: 'licenses' }, 'licenses', { timeoutMs: 30_000 }).catch(
          () => null
        )
      : null,
  ]);
  if (!app) return web;
  const offset = web.texts.length;
  return {
    texts: [...web.texts, ...app.texts],
    libraries: [
      ...web.libraries,
      ...app.libraries.map((l) => ({
        ...l,
        texts: l.texts.map((i) => i + offset),
      })),
    ].sort((a, b) => byName.compare(a.name, b.name)),
  };
}
