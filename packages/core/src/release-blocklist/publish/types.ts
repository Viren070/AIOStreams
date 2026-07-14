export const PUBLISH_FORMATS = ['native', 'warden'] as const;
export const PUBLISH_SCOPES = ['local', 'all'] as const;

export type PublishFormat = (typeof PUBLISH_FORMATS)[number];
export type PublishScope = (typeof PUBLISH_SCOPES)[number];

/** One file a target uploads: a format/scope combination of the list. */
export interface PublishArtifactSpec {
  format: PublishFormat;
  scope: PublishScope;
  gzip: boolean;
}

export type PublishArtifactKey = `${PublishFormat}:${PublishScope}`;

export function artifactKey(spec: PublishArtifactSpec): PublishArtifactKey {
  return `${spec.format}:${spec.scope}`;
}

/** Matches the export endpoint's Content-Disposition naming. */
export function artifactFilename(spec: PublishArtifactSpec): string {
  return `blocklist-${spec.scope}${spec.format === 'warden' ? '-warden' : ''}.ndjson${spec.gzip ? '.gz' : ''}`;
}

/** Marks a persisted status as a failure; everything after it is the reason. */
export const PUBLISH_ERROR_PREFIX = 'error: ';

/**
 * Split a persisted status into the line to show and, when the push failed,
 * the reason on its own. Consumers never have to parse the status string.
 */
export function splitPublishStatus(status: string | null): {
  status: string | null;
  error: string | null;
} {
  if (status?.startsWith(PUBLISH_ERROR_PREFIX)) {
    return {
      status: null,
      error: status.slice(PUBLISH_ERROR_PREFIX.length),
    };
  }
  return { status: status || null, error: null };
}

export interface PublishArtifactState {
  /** sha256 hex over the pre-gzip serialized body. */
  hash: string;
  /** Stable public URL the provider reported for the uploaded file. */
  url?: string;
  pushedAt: number;
}

export type PublishTargetState = Partial<
  Record<PublishArtifactKey, PublishArtifactState>
>;

export interface PublishTarget {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  intervalSeconds: number;
  /** Whole provider config JSON encrypted with the instance secret. */
  configEnc: string;
  artifacts: PublishArtifactSpec[];
  state: PublishTargetState;
  lastPushed: number;
  lastChecked: number;
  status: string | null;
  sort: number;
}
