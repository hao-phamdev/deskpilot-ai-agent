/** localStorage helpers that never throw (private mode, blocked storage, SSR). */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: keep working in memory */
  }
}

/** Minimal observable store usable with React's useSyncExternalStore. */
export function createStore<T>(initial: () => T, persistKey?: string) {
  let state: T | null = null;
  const listeners = new Set<() => void>();
  const serverSnapshot = initial();

  const get = (): T => {
    if (state === null) state = persistKey ? loadJSON(persistKey, initial()) : initial();
    return state;
  };

  return {
    get,
    getServerSnapshot: () => serverSnapshot,
    set(next: T) {
      state = next;
      if (persistKey) saveJSON(persistKey, next);
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
