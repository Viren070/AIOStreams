/** localStorage that tolerates private windows and blocked site data. */
export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

/** A map kept in storage, dropping its oldest entries past `max`. */
export function storedMap<T>(key: string, max: number) {
  const read = () => storage.get<Record<string, T>>(key) ?? {};
  return {
    get: (id: string): T | undefined => read()[id],
    set(id: string, value: T | undefined): void {
      const { [id]: _, ...rest } = read();
      const entries = Object.entries(rest);
      if (value !== undefined) entries.push([id, value]);
      storage.set(key, Object.fromEntries(entries.slice(-max)));
    },
  };
}
