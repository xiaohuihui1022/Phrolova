import { ref, watch, type Ref } from "vue";

/**
 * Reactive localStorage wrapper. Reads on init, writes on change.
 * Each instance is a standalone ref — reads from storage at creation time.
 */
export function useLocalStorage<T = string>(key: string, fallback: T): Ref<T> {
  const stored = readStorage<T>(key, fallback);
  const value = ref<T>(stored) as Ref<T>;

  watch(value, (next) => {
    writeStorage(key, next);
  }, { deep: true });

  return value;
}

/** Non-reactive one-shot read. */
export function readLocalStorage<T = string>(key: string, fallback: T): T {
  return readStorage(key, fallback);
}

export function writeLocalStorage<T = string>(key: string, value: T): void {
  writeStorage(key, value);
}

export function removeLocalStorage(key: string): void {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

/** Reactive sessionStorage wrapper. */
export function useSessionStorage<T = string>(key: string, fallback: T): Ref<T> {
  const stored = readSessionStorage<T>(key, fallback);
  const value = ref<T>(stored) as Ref<T>;

  watch(value, (next) => {
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* noop */ }
  }, { deep: true });

  return value;
}

export function readSessionStorage<T = string>(key: string, fallback: T): T {
  return readFrom(sessionStorage, key, fallback);
}

export function removeSessionStorage(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* noop */ }
}

/* ── Internal helpers ── */

function readStorage<T>(key: string, fallback: T): T {
  return readFrom(localStorage, key, fallback);
}

function writeStorage<T>(key: string, value: T): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else if (typeof value === "string") {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch { /* noop */ }
}

function readFrom<T>(store: Storage, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    if (raw === null) return fallback;
    if (typeof fallback === "string") {
      try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
    }
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  } catch {
    return fallback;
  }
}

