import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seanimeExtDistRoot = path.join(
  __dirname,
  '../../../seanime-extensions/dist'
);

interface SeanimeExtensionManifest {
  name: string;
  id: string;
  manifestURI: string;
  version: string;
  website: string;
  userConfig?: {
    version: number;
    requiresConfig: boolean;
    fields?: Array<{
      type: string;
      name: string;
      label: string;
      default?: string;
      options?: Array<{ value: string; label: string }>;
      description?: string;
    }>;
  };
  payload?: string;
  plugin?: {
    version: string;
    permissions: {
      scopes: string[];
      allow: {
        networkAccess?: {
          allowedDomains: string[];
          reasoning: string;
        };
        readPaths?: string[];
        writePaths?: string[];
      };
    };
  };
  [key: string]: unknown;
}

interface ApplySeanimeManifestRuntimeConfigParams {
  manifestURI: string;
  website: string;
  baseUrl: string;
  stremioManifestUrl?: string;
}

const SEANIME_EXTENSION_IDS = [
  'aiostreams-plugin',
  'aiostreams-torrent-provider',
  'stremio-custom-source',
] as const;

export type SeanimeExtensionId = (typeof SEANIME_EXTENSION_IDS)[number];

export function isValidSeanimeExtensionId(
  extensionId: string
): extensionId is SeanimeExtensionId {
  return SEANIME_EXTENSION_IDS.includes(extensionId as SeanimeExtensionId);
}

export function readSeanimeExtensionManifest(
  extensionId: SeanimeExtensionId
): SeanimeExtensionManifest | null {
  const manifestPath = path.join(
    seanimeExtDistRoot,
    extensionId,
    'manifest.json'
  );
  const resolved = path.resolve(manifestPath);

  if (!resolved.startsWith(path.resolve(seanimeExtDistRoot))) {
    return null;
  }

  if (!fs.existsSync(resolved)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return null;
  }
}

export function getSeanimeExtensionVersion(): string | null {
  for (const extensionId of SEANIME_EXTENSION_IDS) {
    const manifest = readSeanimeExtensionManifest(extensionId);
    if (manifest) {
      return manifest.version;
    }
  }

  return null;
}

export function applySeanimeManifestRuntimeConfig(
  manifest: SeanimeExtensionManifest,
  {
    manifestURI,
    website,
    baseUrl,
    stremioManifestUrl,
  }: ApplySeanimeManifestRuntimeConfigParams
): SeanimeExtensionManifest {
  manifest.manifestURI = manifestURI;
  manifest.website = website;

  if (stremioManifestUrl && manifest.userConfig) {
    const manifestUrlField = manifest.userConfig.fields?.find(
      (f) => f.name === 'manifestUrl'
    );
    if (manifestUrlField) {
      manifestUrlField.default = stremioManifestUrl;
    }
    manifest.userConfig.requiresConfig = false;
  }

  const networkAccess = manifest.plugin?.permissions?.allow?.networkAccess;
  if (networkAccess) {
    try {
      networkAccess.allowedDomains = [new URL(baseUrl).hostname];
      networkAccess.reasoning =
        'Allows the extension to access the AIOStreams server for fetching results and accessing the Anime API';
    } catch {
      // Keep manifest defaults if baseUrl is invalid.
    }
  }

  return manifest;
}
