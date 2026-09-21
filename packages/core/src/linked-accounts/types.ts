export const LINKED_ACCOUNT_PLATFORMS = ['stremio', 'aiomanager'] as const;
export type LinkedAccountPlatformId = (typeof LINKED_ACCOUNT_PLATFORMS)[number];

export type LinkedAccountStatus = 'ok' | 'error' | 'expired';

/** Non-secret per-destination settings. Safe to send to the client. */
export interface LinkedAccountConfig {
  /** AIOManager only. Base URL with no trailing slash. */
  instanceUrl?: string;
  /**
   * We created this session ourselves, so unlinking may sign it out.
   */
  mintedSession?: boolean;
  manifestUrls: string[];
}

export interface LinkedAccount {
  id: string;
  uuid: string;
  platform: LinkedAccountPlatformId;
  label: string;
  identity: string | null;
  config: LinkedAccountConfig;
  autoPush: boolean;
  lastSyncedAt?: number;
  lastStatus?: LinkedAccountStatus;
  lastError?: string;
  /** Fingerprint of the manifests as they were when last pushed. */
  lastPushedManifestHash?: string;
  createdAt: number;
  updatedAt: number;
}

/** Carries the decrypted credentials. Must never be serialised to a client. */
export interface ResolvedLinkedAccount extends LinkedAccount {
  credentials: Record<string, string>;
}

export interface ProbeResult {
  ok: boolean;
  /** Shown to the user when `ok` is false. */
  message?: string;
  /** Whatever version the platform reports, for display only. */
  version?: string;
}

export interface ConnectResult {
  credentials: Record<string, string>;
  config: Partial<LinkedAccountConfig>;
  /** Email, instance host, or whatever identifies the destination to a human. */
  identity: string;
  /** Used when the user does not name the destination themselves. */
  label: string;
}

export type PushOutcomeStatus = 'installed' | 'refreshed' | 'unchanged';

export interface PushOutcome {
  url: string;
  status: PushOutcomeStatus;
}

export interface PushResult {
  outcomes: PushOutcome[];
}

export type LinkedAccountPlatformKind = 'client' | 'manager';

/** A manifest URL together with the manifest the service already fetched for it. */
export interface ResolvedManifest {
  url: string;
  manifest: Record<string, unknown>;
}

export type PlatformFieldType = 'text' | 'password' | 'email' | 'url';

export interface PlatformField {
  /** Key in the `input` object handed to `connect`. */
  key: string;
  label: string;
  type: PlatformFieldType;
  help?: string;
  placeholder?: string;
  optional?: boolean;
}

/** One way of connecting. Its `id` arrives as `input.mode`. */
export interface PlatformAuthMethod {
  id: string;
  label: string;
  /** Shown under the fields, for anything the labels cannot say. */
  note?: string;
  fields: PlatformField[];
}

/**
 * Everything the configure page needs to render a platform without knowing
 * anything about it. Adding a platform is registering a driver, not editing UI.
 */
export interface PlatformDescriptor {
  id: LinkedAccountPlatformId;
  name: string;
  kind: LinkedAccountPlatformKind;
  logo?: string;
  /** One line explaining what linking this platform does. */
  description: string;
  /** Needed whichever auth method is chosen, e.g. a self-hosted instance URL. */
  commonFields?: PlatformField[];
  authMethods: PlatformAuthMethod[];
  /** Field key to run `probe` against as the user types. */
  probeOn?: string;
}

export interface LinkedAccountPlatform extends PlatformDescriptor {
  /** Reachability and capability check, run before and during linking. */
  probe(input: { instanceUrl?: string }): Promise<ProbeResult>;
  /** Validates the supplied credentials and returns what to persist. */
  connect(input: Record<string, unknown>): Promise<ConnectResult>;
  /** Idempotently ensures each manifest is installed and current. */
  push(
    account: ResolvedLinkedAccount,
    manifests: ResolvedManifest[]
  ): Promise<PushResult>;
  /** Withdraws the stored credential on unlink, where the platform allows it. */
  revoke?(account: ResolvedLinkedAccount): Promise<void>;
}
