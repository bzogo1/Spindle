/**
 * Above-the-fold CSS for the `(site)` route group, inlined into <head> so the
 * first paint is styled before the deferred stylesheet arrives.
 *
 * Coverage: design tokens (both themes), base resets, skip link, header,
 * buttons, hero and generic page-hero chrome — everything visible in the
 * initial viewport on any marketing page.
 *
 * The full `styles.css`/`auth.css` payload is loaded asynchronously by
 * `DeferredStylesLoader` (src/components/site/deferred-styles-loader.tsx).
 * Rules here intentionally duplicate a subset of styles.css; keep selectors
 * and values in sync when the source tokens change.
 */
export const SITE_CRITICAL_CSS = `
:root {
  --bg: #0d0f0e;
  --bg-alt: #101211;
  --surface: #141715;
  --surface-2: #181c19;
  --surface-3: #1e231f;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --text: #e9ede8;
  --text-muted: #9aa49c;
  --text-dim: #7d877e;
  --accent: #c8f083;
  --accent-hover: #d8f7a6;
  --accent-soft: rgba(200, 240, 131, 0.09);
  --accent-line: rgba(200, 240, 131, 0.24);
  --amber: #e3b67e;
  --mint: #96d8ad;
  --radius: 8px;
  --radius-lg: 12px;
  --container: 1160px;
  --focus-ring: 2px solid var(--accent);
  --transition-normal: 0.2s ease;
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --ui-primary-foreground: #12160f;
  color-scheme: dark;
}
:root:not(.dark) {
  color-scheme: light;
  --bg: #f6f7f5;
  --bg-alt: #eceee9;
  --surface: #ffffff;
  --surface-2: #f4f6f2;
  --surface-3: #e7eae4;
  --border: rgba(15, 25, 18, 0.1);
  --border-strong: rgba(15, 25, 18, 0.18);
  --text: #1a201b;
  --text-muted: #5d6960;
  --text-dim: #5c6861;
  --accent: #3f6418;
  --accent-hover: #3d6118;
  --accent-soft: rgba(63, 100, 24, 0.08);
  --accent-line: rgba(63, 100, 24, 0.26);
  --amber: #8a5a1e;
  --mint: #2f7d4f;
  --ui-primary-foreground: #ffffff;
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
[hidden] {
  display: none;
}
html {
  -webkit-text-size-adjust: 100%;
  scroll-padding-top: 80px;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}
a {
  color: inherit;
  text-decoration: none;
}
button,
input {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
}
img,
svg {
  display: block;
}
::selection {
  background: var(--accent-line);
  color: var(--text);
}
:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 3px;
  border-radius: 3px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.skip-link {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--ui-primary-foreground);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-decoration: none;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.skip-link:focus-visible {
  width: auto;
  height: auto;
  margin: 0;
  overflow: visible;
  clip: auto;
  clip-path: none;
}
.container {
  width: 100%;
  max-width: var(--container);
  margin: 0 auto;
  padding: 0 32px;
  position: relative;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 6px;
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid transparent;
  transition:
    background var(--transition-normal),
    border-color var(--transition-normal),
    color var(--transition-normal);
}
.btn--lg {
  padding: 12px 20px;
  font-size: 14px;
}
.btn--primary {
  background: var(--accent);
  color: var(--ui-primary-foreground);
  border-color: var(--accent);
}
.btn--primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.btn--ghost {
  background: transparent;
  color: var(--text);
  border-color: var(--border-strong);
}
.btn--ghost:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.25);
}
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid transparent;
  background: rgba(13, 15, 14, 0.88);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transition: border-color var(--transition-normal);
}
:root:not(.dark) .site-header {
  background: rgba(246, 247, 245, 0.88);
}
:root:not(.dark) .btn--ghost:hover {
  background: rgba(15, 25, 18, 0.05);
  border-color: rgba(15, 25, 18, 0.28);
}
.site-header.scrolled {
  border-bottom-color: var(--border);
}
.header-inner {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.brand-mark {
  width: 25px;
  height: 25px;
  display: grid;
  place-items: center;
  color: var(--accent);
}
.brand-mark svg {
  width: 100%;
  height: 100%;
}
.brand-name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.035em;
  color: var(--text);
}
.nav-desktop-slot {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}
.nav-fallback {
  display: flex;
  align-items: center;
  gap: 2px;
}
.nav-fallback a {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 11px;
  border-radius: 5px;
  color: var(--text-muted);
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 18px;
  flex: none;
}
.sign-in {
  font-size: 13.5px;
  color: var(--text-muted);
}
.menu-toggle,
.site-theme-toggle {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
}
.nav-mobile {
  display: none;
}
.hero {
  padding: 92px 0 0;
  position: relative;
}
.hero-inner {
  text-align: center;
  position: relative;
}
.hero-announce {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 24px;
}
.hero-title {
  font-size: clamp(2.85rem, 5.6vw, 4.3rem);
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.04em;
  margin: 0 auto 22px;
  max-width: 860px;
}
.hero-subtitle {
  font-size: 17px;
  line-height: 1.7;
  color: var(--text-muted);
  max-width: 600px;
  margin: 0 auto;
}
.hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  margin-top: 32px;
}
.hero-secondary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13.5px;
  color: var(--text-muted);
}
.hero-visual {
  max-width: 1060px;
  margin: 64px auto 0;
  text-align: left;
  position: relative;
}
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 14px;
}
.page-main {
  padding-top: 0;
}
.page-hero {
  padding: 88px 0 68px;
  border-bottom: 1px solid var(--border);
}
.page-hero > .container {
  max-width: 860px;
}
.page-title {
  font-size: clamp(2.4rem, 5vw, 3.6rem);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.045em;
  margin: 0 0 18px;
}
.page-lede {
  font-size: 17px;
  line-height: 1.7;
  color: var(--text-muted);
  margin: 0;
  max-width: 660px;
}
`

/**
 * Above-the-fold CSS for the `(auth)` route group (reset-password,
 * verify-email, magic-link, oauth callback), inlined into <head> so the
 * first paint is styled before the deferred stylesheet arrives.
 *
 * Coverage: the same design tokens and base resets as SITE_CRITICAL_CSS
 * (auth pages use the identical palette, and light/dark flip via the same
 * `.dark` class on <html>), the skip link, and the full auth shell —
 * `.auth-*` layout, card, form, state and spinner rules mirrored from
 * `src/app/styles/auth.css`. `--ui-*` tokens and `.ui-*`/Tailwind classes
 * used by auth forms come from `index.css`/`ui.css`, which stay
 * render-blocking in the auth layout.
 *
 * The full `styles.css`/`auth.css` payload is loaded asynchronously by
 * `DeferredStylesLoader` (src/components/site/deferred-styles-loader.tsx).
 * Keep selectors and values in sync with auth.css when it changes.
 */
export const AUTH_CRITICAL_CSS = `
:root {
  --bg: #0d0f0e;
  --bg-alt: #101211;
  --surface: #141715;
  --surface-2: #181c19;
  --surface-3: #1e231f;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --text: #e9ede8;
  --text-muted: #9aa49c;
  --text-dim: #7d877e;
  --accent: #c8f083;
  --accent-hover: #d8f7a6;
  --accent-soft: rgba(200, 240, 131, 0.09);
  --accent-line: rgba(200, 240, 131, 0.24);
  --amber: #e3b67e;
  --mint: #96d8ad;
  --radius: 8px;
  --radius-lg: 12px;
  --container: 1160px;
  --focus-ring: 2px solid var(--accent);
  --transition-normal: 0.2s ease;
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --ui-primary-foreground: #12160f;
  color-scheme: dark;
}
:root:not(.dark) {
  color-scheme: light;
  --bg: #f6f7f5;
  --bg-alt: #eceee9;
  --surface: #ffffff;
  --surface-2: #f4f6f2;
  --surface-3: #e7eae4;
  --border: rgba(15, 25, 18, 0.1);
  --border-strong: rgba(15, 25, 18, 0.18);
  --text: #1a201b;
  --text-muted: #5d6960;
  --text-dim: #5c6861;
  --accent: #3f6418;
  --accent-hover: #3d6118;
  --accent-soft: rgba(63, 100, 24, 0.08);
  --accent-line: rgba(63, 100, 24, 0.26);
  --amber: #8a5a1e;
  --mint: #2f7d4f;
  --ui-primary-foreground: #ffffff;
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
[hidden] {
  display: none;
}
html {
  -webkit-text-size-adjust: 100%;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}
a {
  color: inherit;
  text-decoration: none;
}
button,
input {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
}
img,
svg {
  display: block;
}
::selection {
  background: var(--accent-line);
  color: var(--text);
}
:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 3px;
  border-radius: 3px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.skip-link {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--ui-primary-foreground);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-decoration: none;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.skip-link:focus-visible {
  width: auto;
  height: auto;
  margin: 0;
  overflow: visible;
  clip: auto;
  clip-path: none;
}
.auth-body {
  min-height: 100svh;
  background: var(--bg);
  color: var(--text);
}
.auth-glow {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 620px 420px at 50% -8%, rgba(200, 240, 131, 0.07), transparent 70%),
    radial-gradient(ellipse 520px 380px at 92% 108%, rgba(150, 216, 173, 0.04), transparent 70%);
}
.auth-main {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  min-height: 100svh;
  padding: 56px 24px;
}
.auth-shell {
  display: grid;
  gap: 18px;
  width: min(430px, 100%);
}
.auth-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  justify-self: center;
  color: var(--text);
  text-decoration: none;
}
.auth-brand:hover {
  color: var(--text);
  text-decoration: none;
}
.auth-brand-mark {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  color: var(--accent);
}
.auth-brand-mark svg {
  width: 100%;
  height: 100%;
}
.auth-brand-name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.035em;
}
.auth-card {
  display: grid;
  gap: 16px;
  padding: 32px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: 0 30px 80px -38px rgba(0, 0, 0, 0.9);
}
.auth-eyebrow {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
}
.auth-title {
  margin: 0;
  font-size: clamp(1.45rem, 4vw, 1.75rem);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.035em;
  color: var(--text);
  outline: none;
}
.auth-desc {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--text-muted);
}
.auth-form {
  display: grid;
  gap: 14px;
  margin-top: 2px;
}
.auth-submit {
  width: 100%;
  height: 40px;
}
.auth-secondary-btn {
  width: 100%;
  height: 36px;
  border-color: var(--border-strong);
  background: transparent;
  color: var(--text-muted);
}
.auth-secondary-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}
.auth-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.auth-link-button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 12.5px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.auth-link-button:hover {
  color: var(--accent);
}
.auth-card-foot {
  text-align: center;
  font-size: 12.5px;
  color: var(--text-dim);
}
.auth-card-foot a {
  color: var(--text-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.auth-card-foot a:hover {
  color: var(--accent);
}
.auth-legal {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.03em;
  color: var(--text-dim);
}
.auth-legal a {
  color: var(--text-dim);
}
.auth-legal a:hover {
  color: var(--text-muted);
}
.auth-password {
  position: relative;
  display: grid;
}
.auth-password input {
  padding-right: 42px;
}
.auth-password-toggle {
  position: absolute;
  top: 50%;
  right: 4px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-dim);
  transform: translateY(-50%);
}
.auth-password-toggle:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}
.auth-password-toggle svg {
  width: 15px;
  height: 15px;
}
.auth-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
}
.auth-error {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ui-destructive);
}
.auth-state {
  display: grid;
  gap: 14px;
  justify-items: start;
  outline: none;
}
.auth-state-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--accent-line);
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}
.auth-state-icon svg {
  width: 20px;
  height: 20px;
}
.auth-state-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.03em;
  color: var(--text);
}
.auth-state-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--text-muted);
}
.auth-state-text strong {
  color: var(--text);
  font-weight: 500;
}
.auth-actions {
  display: grid;
  gap: 10px;
  justify-items: start;
  width: 100%;
}
.auth-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.auth-badge svg {
  width: 12px;
  height: 12px;
}
.auth-badge--warn {
  border-color: rgba(227, 182, 126, 0.32);
  background: rgba(227, 182, 126, 0.07);
  color: var(--amber);
}
.auth-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex: none;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: auth-spin 0.8s linear infinite;
}
.auth-spinner--lg {
  width: 20px;
  height: 20px;
}
@keyframes auth-spin {
  to {
    transform: rotate(360deg);
  }
}
.auth-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}
@media (max-width: 480px) {
  .auth-main {
    padding: 32px 16px;
  }
  .auth-card {
    padding: 24px 20px;
    border-radius: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .auth-spinner {
    animation: none;
  }
}
:root:not(.dark) .auth-error {
  color: #b3261e;
}
:root:not(.dark) .auth-secondary-btn:hover,
:root:not(.dark) .auth-password-toggle:hover {
  background: rgba(15, 25, 18, 0.05);
}
`
