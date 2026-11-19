/* Changelog page interactions — the light/dark theme toggle. */

/* Runs after hydration from a client component. */
let started = false

export function initChangelog() {
  if (started) return
  started = true

  const root = document.documentElement
  const themeToggle = document.querySelector(".cl-theme-toggle")

  themeToggle?.addEventListener("click", () => {
    const dark = !root.classList.contains("dark")
    root.classList.toggle("dark", dark)
    try {
      localStorage.setItem("changelog-theme", dark ? "dark" : "light")
    } catch (e) {
      // Storage can be unavailable when the page is opened from disk.
      if (window.Sentry) {
        window.Sentry.captureException(e)
      }
    }
  })
}
