import type {
  ShareCollection,
  ShareContext,
  ShareNode,
  ShareProvider,
  ShareScope,
} from './types.js';

const registries = new Map<ShareScope, Map<string, ShareProvider>>();

function registry(scope: ShareScope): Map<string, ShareProvider> {
  let providers = registries.get(scope);
  if (!providers) registries.set(scope, (providers = new Map()));
  return providers;
}

function scopeOf(ctx: ShareContext): ShareScope {
  return ctx.scope ?? 'library';
}

/** Modified date for synthetic collections that have no natural one. */
export const SHARE_EPOCH = new Date('2024-01-01T00:00:00Z');

export function registerShareProvider(provider: ShareProvider): void {
  registry(provider.scope ?? 'library').set(provider.name, provider);
}

export function unregisterShareProvider(
  name: string,
  scope: ShareScope = 'library'
): void {
  registry(scope).delete(name);
}

export function shareProviders(scope: ShareScope = 'library'): ShareProvider[] {
  return [...registry(scope).values()];
}

/** A name a client may ask for as one path component. */
export function isValidShareName(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\0')
  );
}

/** Split a node path into its components, without decoding. */
export function splitSharePath(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/** The path of a node's parent; the root is its own parent. */
export function shareParentPath(path: string): string {
  const segments = splitSharePath(path);
  segments.pop();
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Split and percent-decode a share path into segments. Returns undefined for a
 * path that is malformed or tries to escape upward.
 */
export function parseSharePath(path: string): string[] | undefined {
  const segments: string[] = [];
  for (const raw of path.split('/')) {
    if (raw === '') continue;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (!isValidShareName(segment)) return undefined;
    segments.push(segment);
  }
  return segments;
}

/** Resolve share path segments: the first names the provider. */
export async function resolveShareSegments(
  segments: string[],
  ctx: ShareContext
): Promise<ShareNode | undefined> {
  if (segments.length === 0) return root(ctx);
  const provider = registry(scopeOf(ctx)).get(segments[0]);
  if (!provider) return undefined;
  return provider.resolve(segments.slice(1), ctx);
}

/** Resolve a node path as stored on a node: verbatim, not percent-encoded. */
export async function resolveShareNodePath(
  path: string,
  ctx: ShareContext
): Promise<ShareNode | undefined> {
  const segments = splitSharePath(path);
  if (!segments.every(isValidShareName)) return undefined;
  return resolveShareSegments(segments, ctx);
}

/** Resolve a percent-encoded, client-supplied share path. */
export async function resolveSharePath(
  path: string,
  ctx: ShareContext
): Promise<ShareNode | undefined> {
  const segments = parseSharePath(path);
  if (!segments) return undefined;
  return resolveShareSegments(segments, ctx);
}

/**
 * One child of a collection by name. Providers already resolve a path one
 * component at a time, so the default re-resolves `parent/name` rather than
 * listing the parent.
 */
export async function lookupShareChild(
  parent: ShareCollection,
  name: string,
  ctx: ShareContext
): Promise<ShareNode | undefined> {
  if (!isValidShareName(name)) return undefined;
  if (parent.child) return parent.child(name);
  return resolveShareSegments([...splitSharePath(parent.path), name], ctx);
}

function root(ctx: ShareContext): ShareCollection {
  const providers = registry(scopeOf(ctx));
  return {
    kind: 'collection',
    path: '/',
    name: '',
    modified: SHARE_EPOCH,
    children: async () => {
      const nodes = await Promise.all(
        [...providers.values()].map((p) => p.resolve([], ctx))
      );
      return nodes.filter((n): n is ShareNode => n !== undefined);
    },
    child: async (name) => providers.get(name)?.resolve([], ctx),
  };
}
