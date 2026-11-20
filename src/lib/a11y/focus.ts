/**
 * Shared focus-management helpers for overlays that are not built on Radix
 * (which manages its own focus trap). Keep the selector aligned with the
 * platform's notion of "focusable": natively interactive elements plus
 * explicit positive `tabindex` values.
 */

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "object",
  "embed",
  "audio[controls]",
  "video[controls]",
  "[contenteditable='true']",
  "[tabindex]",
].join(",")

function isFocusableElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  if (element.hasAttribute("disabled")) return false
  if (element.getAttribute("aria-hidden") === "true") return false
  if (element.hidden) return false
  const tabIndex = element.getAttribute("tabindex")
  if (tabIndex !== null && Number(tabIndex) < 0) return false
  return true
}

/**
 * True when an ancestor between `element` and `boundary` (inclusive) is
 * `aria-hidden` or `hidden`. Descendants of inert containers are not part of
 * the tab order even though `querySelectorAll` still returns them.
 */
function hasInertAncestor(element: HTMLElement, boundary: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node) {
    if (node !== element && (node.getAttribute("aria-hidden") === "true" || node.hidden)) {
      return true
    }
    if (node === boundary) return false
    node = node.parentElement
  }
  return false
}

/**
 * Returns the focusable descendants of `container` in DOM order. Elements
 * with `tabindex="-1"` are excluded — they are programmatically focusable but
 * not part of the tab order, so they must not participate in a focus trap.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => isFocusableElement(element) && !hasInertAncestor(element, container),
  )
}

/** Moves focus to `element`, swallowing focus errors from detached nodes. */
export function focusElement(element: HTMLElement | null | undefined): void {
  if (!element) return
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
}
