/**
 * SSR-safe localStorage helpers shared by the ops modules (marketplace
 * registry, audit log persistence, auto-backup). Every access is guarded so
 * the modules work under vitest/jsdom, SSR, and privacy modes where storage
 * may throw.
 */

export function storageGet(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storageSet(key: string, value: string): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function storageRemove(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/** Read + JSON.parse a stored value; returns `fallback` on any failure. */
export function storageGetJson<T>(key: string, fallback: T): T {
  const raw = storageGet(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** JSON.stringify + storageSet; returns false when storage is unavailable. */
export function storageSetJson(key: string, value: unknown): boolean {
  try {
    return storageSet(key, JSON.stringify(value))
  } catch {
    return false
  }
}
