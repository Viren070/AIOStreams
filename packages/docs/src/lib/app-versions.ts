import { readFileSync } from 'node:fs';
import path from 'node:path';

export type AppVersions = Partial<
  Record<'desktop' | 'android' | 'smart-tv', string>
>;

export function appVersions(): AppVersions {
  try {
    const manifest = JSON.parse(
      readFileSync(
        path.join(process.cwd(), '../../.release-please-manifest.json'),
        'utf8'
      )
    ) as Record<string, string>;
    return {
      desktop: manifest['packages/desktop'],
      android: manifest['packages/android'],
      'smart-tv': manifest['packages/smart-tv'],
    };
  } catch {
    return {};
  }
}
