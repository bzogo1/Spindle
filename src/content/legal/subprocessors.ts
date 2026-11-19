/**
 * Third-party providers that process personal data for Spindle.
 *
 * This is the single source for the subprocessor table. Add a vendor here
 * before it handles any data, and the privacy policy (and the DPA at `/dpa`,
 * once published) will render the updated list.
 */
export type Subprocessor = {
  /** Trading name shown to readers. */
  vendor: string
  /** What the vendor does for Spindle. */
  purpose: string
  /** The categories of personal data the vendor can access. */
  data: string
  /** Where the vendor stores or processes the data. */
  location: string
  /** The mechanism that covers transfers outside the EEA/UK, if any. */
  transfer: string
}

export const subprocessors: readonly Subprocessor[] = [
  {
    vendor: "Backblaze (B2)",
    purpose: "File and project object storage",
    data: "Project files, notebook output, file metadata",
    location: "United States and European Union",
    transfer: "Standard Contractual Clauses",
  },
  {
    vendor: "Cloudflare",
    purpose: "CDN, TLS termination, bot protection, and private tunnels",
    data: "IP address, request and device metadata",
    location: "Global edge network",
    transfer: "Standard Contractual Clauses",
  },
  {
    vendor: "Google Fonts",
    purpose: "Web font delivery for the marketing site",
    data: "IP address, browser and device metadata",
    location: "United States and global edge network",
    transfer: "Standard Contractual Clauses",
  },
  {
    vendor: "Resend",
    purpose: "Transactional email: verification, password reset, invitations, and support replies",
    data: "Email address, name, message metadata, and delivery status",
    location: "United States",
    transfer: "Standard Contractual Clauses",
  },
  {
    vendor: "LLM provider",
    purpose: "Model inference for agent and automation requests",
    data: "Prompts and the project context included in a request",
    location: "United States",
    transfer: "Standard Contractual Clauses",
  },
  {
    vendor: "Hosting provider",
    purpose: "Application, worker, and lab container hosting",
    data: "Account and workspace data, request metadata, and session state",
    location: "European Union and United States",
    transfer: "Standard Contractual Clauses",
  },
  {
    vendor: "Sentry",
    purpose: "Error monitoring, performance traces, and masked session replay",
    data: "Diagnostics, browser and device metadata",
    location: "United States",
    transfer: "Standard Contractual Clauses",
  },
]
