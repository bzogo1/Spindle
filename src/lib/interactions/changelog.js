/* Changelog page interactions — per-release "Copy link" buttons. */

/* Runs after hydration from a client component. */
let started = false

export function initChangelog() {
  if (started) return
  started = true

  // Delegated on document so buttons rendered by later client-side navigations
  // (this component persists across SPA route changes) still work.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    // "Copy link" buttons on each release put the absolute permalink on the
    // clipboard; the label flips to "Copied" briefly as confirmation.
    const button = target.closest(".cl-copy-link")
    if (!button) return

    const path = button.getAttribute("data-url") || "/changelog"
    const url = new URL(path, window.location.origin).href
    const label = button.textContent

    navigator.clipboard
      .writeText(url)
      .then(() => {
        button.textContent = "Copied"
        window.setTimeout(() => {
          button.textContent = label
        }, 1600)
      })
      .catch((e) => {
        // Clipboard can be denied (permissions, non-secure context).
        if (window.Sentry) {
          window.Sentry.captureException(e)
        }
      })
  })
}
