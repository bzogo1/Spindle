"use client"

/**
 * Completion persistence for the tutorial engine. State lives in
 * localStorage so a finished tour stays finished across sessions; callers
 * can reset it with `resetTutorialCompletion`.
 */

const KEY_PREFIX = "spindle.tutorial."
const KEY_SUFFIX = ".completed"

export function tutorialStorageKey(tutorialId: string): string {
  return `${KEY_PREFIX}${tutorialId}${KEY_SUFFIX}`
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

export function isTutorialCompleted(tutorialId: string): boolean {
  return storage()?.getItem(tutorialStorageKey(tutorialId)) === "1"
}

export function markTutorialCompleted(tutorialId: string): void {
  try {
    storage()?.setItem(tutorialStorageKey(tutorialId), "1")
  } catch {
    // Storage may be unavailable (private mode, quota) — completion is
    // best-effort and the in-memory flow still works.
  }
}

export function resetTutorialCompletion(tutorialId: string): void {
  try {
    storage()?.removeItem(tutorialStorageKey(tutorialId))
  } catch {
    // ignore
  }
}
