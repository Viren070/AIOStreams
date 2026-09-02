// Dependency-free so a class can self-register without a circular-import
// risk via the utils barrel.
export type ErrorCtor = new (...args: any[]) => Error;

const registry = new Map<string, ErrorCtor>();

// Preserves a custom Error subclass's prototype/instanceof across a lock's
// JSON round-trip. Natives (TypeError, ...) resolve via globalThis instead.
export function registerLockErrorClass(ctor: ErrorCtor): void {
  registry.set(ctor.name, ctor);
}

export function resolveErrorCtor(
  className: string | undefined
): ErrorCtor | undefined {
  if (!className) return undefined;
  if (registry.has(className)) return registry.get(className);
  const global = (globalThis as any)[className];
  return typeof global === 'function' && global.prototype instanceof Error
    ? global
    : undefined;
}
