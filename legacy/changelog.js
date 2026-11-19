/* Changelog page interactions — theme toggle, accordions, and code copy. */

const root = document.documentElement
const themeToggle = document.querySelector('.cl-theme-toggle')

themeToggle?.addEventListener('click', () => {
  const dark = !root.classList.contains('dark')
  root.classList.toggle('dark', dark)
  try {
    localStorage.setItem('changelog-theme', dark ? 'dark' : 'light')
  } catch (e) {
    // Storage can be unavailable when the page is opened from disk.
  }
})

document.querySelectorAll('.cl-accordion-trigger').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') !== 'true'
    trigger.setAttribute('aria-expanded', String(open))
    const panel = trigger.closest('.cl-accordion-item')?.querySelector('.cl-accordion-content')
    if (panel) panel.hidden = !open
  })
})

document.querySelectorAll('.cl-code-copy').forEach((button) => {
  button.addEventListener('click', async () => {
    const text = button.closest('.cl-code')?.querySelector('code')?.innerText
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      button.setAttribute('aria-label', 'Copied')
      window.setTimeout(() => button.setAttribute('aria-label', 'Copy Text'), 1500)
    } catch (e) {
      button.setAttribute('aria-label', 'Copy failed')
      window.setTimeout(() => button.setAttribute('aria-label', 'Copy Text'), 1500)
    }
  })
})
