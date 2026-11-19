import { CookieSettingsButton } from "@/components/site/cookie-settings-button"
import { SocialLinks } from "@/components/site/social-links"

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="/" className="brand" aria-label="Spindle home">
              <span className="brand-mark">
                <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <path
                    d="M8 10.5C8 7.5 10.2 5 13 5h6c2.8 0 5 2.5 5 5.5v1.7c0 2.4-1.8 4.3-4.2 4.3h-3.6C13.8 21.5 12 23.4 12 25.8c0 .8.6 1.2 1.4 1.2h5.2c2.8 0 5-2.5 5-5.5"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="22" r="2.2" fill="currentColor" />
                </svg>
              </span>
              <span className="brand-name">spindle</span>
            </a>
            <p>One place for all your research.</p>
            <div className="socials">
              <SocialLinks />
            </div>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <h4>Product</h4>
              <a href="/platform">Platform overview</a>
              <a href="/#files">Files</a>
              <a href="/lab">Lab</a>
              <a href="/#search">Search</a>
              <a href="/automations">Automations</a>
              <a href="/infrastructure">Infrastructure</a>
              <a href="/pricing">Pricing</a>
            </div>
            <div className="footer-col">
              <h4>Workspace</h4>
              <a href="/#integrations">Integrations</a>
              <a href="/agent">Agent</a>
              <a href="/#chat">Team chat</a>
              <a href="/collaboration">Collaboration</a>
              <a href="/#get-started">Get started</a>
            </div>
            <div className="footer-col">
              <h4>Resources</h4>
              <a href="/docs">Documentation</a>
              <a href="/docs/quickstart">Quickstart</a>
              <a href="/docs/guides">Guides</a>
              <a href="/changelog">Changelog</a>
            </div>
            <div className="footer-col">
              <h4>Company</h4>
              <a href="/about">About</a>
              <a href="/about#contact">Contact</a>
              <a href="/terms">Terms of Service</a>
              <a href="/privacy">Privacy</a>
              <a href="/cookies">Cookie Policy</a>
              <a href="/acceptable-use">Acceptable use</a>
              <a href="/dpa">DPA &amp; subprocessors</a>
              <a href="/security">Security</a>
              <a href="/accessibility">Accessibility</a>
              <a
                href="https://github.com/spindle-labs/spindle"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub ↗
              </a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Spindle Labs. Built for curious people.</span>
          <div className="footer-bottom-actions">
            <CookieSettingsButton className="footer-cookie-settings" />
            <span className="system-status">
              <i></i> All systems operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
