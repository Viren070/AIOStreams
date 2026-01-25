import { makeRequest } from './http.js';
import { createLogger } from './logger.js';
import { FULL_LANGUAGE_MAPPING } from './languages.js';
import { PARSE_REGEX } from '../parser/regex.js';

const logger = createLogger('subdetect');

const SUBDETECT_API_URL = 'https://subdetect.chromeknight.dev';
const MAX_BATCH_SIZE = 20;

/**
 * Checks if a filename matches the scene release naming convention.
 * Scene releases follow these rules:
 * - No spaces (always dots as separators)
 * - Must contain dots (Title.Year.Format pattern)
 * - Ends with -GroupName (at least 2 characters)
 */
export function isSceneRelease(filename: string): boolean {
  if (filename.includes(' ')) return false;
  if (!filename.includes('.')) return false;
  return PARSE_REGEX.sceneRelease.test(filename);
}

interface SubDetectResult {
  release_name: string;
  language_codes: string[];
  nfo_found: boolean;
}

interface SubDetectProcessResponse {
  results: SubDetectResult[];
}

interface SubDetectApiKeyResponse {
  api_key: string;
  created_at: string;
}

export function convertISO6392ToLanguage(code: string): string | undefined {
  const lang = FULL_LANGUAGE_MAPPING.find(
    (language) => language.iso_639_2 === code.toLowerCase()
  );
  return lang?.english_name?.split('(')?.[0]?.trim();
}

export async function generateApiKey(): Promise<{
  apiKey: string;
  createdAt: string;
} | null> {
  try {
    const response = await makeRequest(
      `${SUBDETECT_API_URL}/api/generate-key`,
      {
        method: 'POST',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      logger.error(`Failed to generate SubDetect API key: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as SubDetectApiKeyResponse;
    logger.info('Successfully generated SubDetect API key');
    return {
      apiKey: data.api_key,
      createdAt: data.created_at,
    };
  } catch (error) {
    logger.error('Error generating SubDetect API key:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function processReleases(
  apiKey: string,
  releases: string[]
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();

  if (!apiKey || releases.length === 0) {
    return results;
  }

  for (let i = 0; i < releases.length; i += MAX_BATCH_SIZE) {
    const batch = releases.slice(i, i + MAX_BATCH_SIZE);

    try {
      const response = await makeRequest(
        `${SUBDETECT_API_URL}/api/process`,
        {
          method: 'POST',
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify({ releases: batch }),
        }
      );

      if (response.status === 429) {
        logger.warn(
          'SubDetect rate limit exceeded, skipping remaining batches'
        );
        break;
      }

      if (response.status === 401) {
        logger.error('SubDetect API key is invalid or expired');
        break;
      }

      if (!response.ok) {
        logger.error(`SubDetect API error: ${response.status}`);
        continue;
      }

      const data = (await response.json()) as SubDetectProcessResponse;

      for (const result of data.results) {
        if (result.nfo_found && result.language_codes.length > 0) {
          const languages = result.language_codes
            .map((code) => convertISO6392ToLanguage(code))
            .filter((lang): lang is string => lang !== undefined);

          if (languages.length > 0) {
            results.set(result.release_name, languages);
          }
        }
      }
    } catch (error) {
      logger.error('Error processing releases with SubDetect:', {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
      });
    }
  }

  return results;
}

export class SubDetectService {
  private apiKey: string | undefined;
  private enabled: boolean;

  constructor(apiKey?: string, enabled: boolean = false) {
    this.apiKey = apiKey;
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled && !!this.apiKey;
  }

  /**
   * Process release names and return detected languages.
   * Returns a map of release name -> detected languages.
   */
  async detectLanguages(
    releaseNames: string[]
  ): Promise<Map<string, string[]>> {
    if (!this.isEnabled() || !this.apiKey) {
      return new Map();
    }

    const uniqueReleases = [
      ...new Set(releaseNames.filter((r) => r && isSceneRelease(r))),
    ];

    if (uniqueReleases.length === 0) {
      logger.debug('No scene releases found to process with SubDetect');
      return new Map();
    }

    logger.info(
      `Processing ${uniqueReleases.length} scene releases with SubDetect API (filtered from ${releaseNames.length} total)`
    );

    return await processReleases(this.apiKey, uniqueReleases);
  }
}
