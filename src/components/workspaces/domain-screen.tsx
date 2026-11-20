"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Globe, Trash2 } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

/**
 * Custom domain screen for `/app/workspaces/[id]/domain`.
 *
 * Loads `GET /api/workspaces/{id}/domain` (role + domain record; the
 * `verificationToken` is only present for owner/admin) and mutates via
 * `PUT` (set/replace), `POST {action:"verify"}` (confirm ownership), and
 * `DELETE` (remove). Members see the status read-only. DNS instructions
 * show the TXT record value `spindle-verify=<token>` — the prefix mirrors
 * `VERIFICATION_TXT_PREFIX` in `@/lib/workspace-domains`, which cannot be
 * imported here because that module pulls in `node:crypto`.
 */

// Keep in sync with VERIFICATION_TXT_PREFIX in src/lib/workspace-domains.ts.
const TXT_PREFIX = "spindle-verify="

type DomainStatus = "pending" | "verified" | "disabled"

interface DomainRecord {
  domain: string
  status: DomainStatus
  verifiedAt: string | null
  createdAt: string
  verificationToken?: string
}

interface DomainResponse {
  ok: boolean
  role?: string
  domain?: DomainRecord | null
  message?: string
}

const STATUS_LABELS: Record<DomainStatus, string> = {
  pending: "Pending verification",
  verified: "Verified",
  disabled: "Disabled",
}

function statusVariant(status: DomainStatus) {
  if (status === "verified") return "default" as const
  if (status === "disabled") return "outline" as const
  return "secondary" as const
}

export function WorkspaceDomainScreen({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [role, setRole] = useState<string | null>(null)
  const [domain, setDomain] = useState<DomainRecord | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [domainInput, setDomainInput] = useState("")
  const [tokenInput, setTokenInput] = useState("")
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [busy, setBusy] = useState<"save" | "verify" | "remove" | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/domain`, {
        cache: "no-store",
      })
      const data = (await response.json()) as DomainResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load the custom domain.")
        setDomain(null)
        return
      }
      setRole(data.role ?? null)
      setDomain(data.domain ?? null)
      setLoaded(true)
    } catch {
      setError("Could not load the custom domain. Check your connection and try again.")
      setDomain(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = role === "owner" || role === "admin"

  async function saveDomain() {
    const value = domainInput.trim()
    if (!value || busy || !canManage) return
    setBusy("save")
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/domain`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: value }),
      })
      const data = (await response.json()) as DomainResponse
      if (!response.ok || !data.ok || !data.domain) {
        toast({
          title: "Couldn't save domain",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      setDomain(data.domain)
      setDomainInput("")
      setTokenInput("")
      setConfirmingRemove(false)
      toast({
        title: "Domain saved",
        description: "Publish the DNS TXT record below, then verify the domain.",
        variant: "success",
      })
    } catch {
      toast({
        title: "Couldn't save domain",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  async function verifyDomain() {
    const token = tokenInput.trim()
    if (!token || busy || !canManage) return
    setBusy("verify")
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/domain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", token }),
      })
      const data = (await response.json()) as DomainResponse
      if (!response.ok || !data.ok || !data.domain) {
        toast({
          title: "Verification failed",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      setDomain(data.domain)
      setTokenInput("")
      toast({
        title: "Domain verified",
        description: `${data.domain.domain} is now verified for this workspace.`,
        variant: "success",
      })
    } catch {
      toast({
        title: "Verification failed",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  async function removeDomain() {
    if (busy || !canManage) return
    if (!confirmingRemove) {
      setConfirmingRemove(true)
      return
    }
    setBusy("remove")
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/domain`, {
        method: "DELETE",
      })
      const data = (await response.json()) as DomainResponse
      if (!response.ok || !data.ok) {
        toast({
          title: "Couldn't remove domain",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      setDomain(null)
      setDomainInput("")
      setTokenInput("")
      setConfirmingRemove(false)
      toast({ title: "Domain removed", variant: "success" })
    } catch {
      toast({
        title: "Couldn't remove domain",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const loading = !loaded && error === null

  return (
    <section className="app-page-card" aria-labelledby="workspace-domain-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="workspace-domain-heading">Custom domain</h2>
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
        {domain ? (
          <Badge variant={statusVariant(domain.status)} size="sm">
            {STATUS_LABELS[domain.status]}
          </Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-sm">
        Point a hostname like <code>app.example.com</code> at this workspace. Ownership is proven by
        publishing a DNS TXT record, then verifying it here.
      </p>

      {error ? (
        <InlineError
          title="Custom domain unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading custom domain" variant="table" />
      ) : (
        <>
          {!canManage ? (
            <p className="text-muted-foreground text-sm" role="note">
              Only workspace owners and admins can change the custom domain. You&apos;re a{" "}
              {role ?? "member"} of this workspace, so the controls below are read-only.
            </p>
          ) : null}

          {domain ? (
            <div className="grid gap-1" role="status">
              <p className="text-sm">
                <strong className="font-mono">{domain.domain}</strong>
                {domain.status === "verified" && domain.verifiedAt ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — verified {new Date(domain.verifiedAt).toLocaleString()}
                  </span>
                ) : null}
              </p>
              {domain.status === "pending" && canManage && domain.verificationToken ? (
                <div className="grid gap-2">
                  <p className="text-sm">Add this TXT record at your DNS provider, then verify:</p>
                  <p className="bg-muted rounded-md px-3 py-2 font-mono text-xs break-all">
                    TXT {domain.domain} → {TXT_PREFIX}
                    {domain.verificationToken}
                  </p>
                  <div className="app-field">
                    <label htmlFor="domain-verify-token">Verification token</label>
                    <input
                      id="domain-verify-token"
                      type="text"
                      value={tokenInput}
                      onChange={(event) => setTokenInput(event.target.value)}
                      placeholder="Paste the token from the TXT record"
                      autoComplete="off"
                    />
                    <p className="app-field-hint">
                      The token value after <code>{TXT_PREFIX}</code> in the TXT record.
                    </p>
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void verifyDomain()}
                      disabled={!tokenInput.trim() || busy !== null}
                    >
                      <Check aria-hidden="true" />
                      {busy === "verify" ? "Verifying…" : "Verify domain"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {domain.status === "pending" && !canManage ? (
                <p className="text-muted-foreground text-sm">
                  Waiting for an owner or admin to publish the DNS TXT record and verify.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No custom domain is configured for this workspace.
            </p>
          )}

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">
              {domain ? "Change domain" : "Add a domain"}
            </legend>
            <div className="app-field">
              <label htmlFor="workspace-domain">Domain</label>
              <input
                id="workspace-domain"
                type="text"
                value={domainInput}
                onChange={(event) => setDomainInput(event.target.value)}
                placeholder="app.example.com"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="app-field-hint">
                Bare hostname only — no protocol, port, or path. Setting a new domain replaces the
                current one and restarts verification.
              </p>
            </div>
            <div className="app-form-actions">
              <Button
                type="button"
                onClick={() => void saveDomain()}
                disabled={!canManage || !domainInput.trim() || busy !== null}
              >
                <Globe aria-hidden="true" />
                {busy === "save" ? "Saving…" : domain ? "Save new domain" : "Add domain"}
              </Button>
              {domain && canManage ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void removeDomain()}
                  disabled={busy !== null}
                >
                  <Trash2 aria-hidden="true" />
                  {confirmingRemove ? "Confirm removal" : "Remove domain"}
                </Button>
              ) : null}
            </div>
            {confirmingRemove && domain ? (
              <p className="text-destructive text-sm" role="alert">
                Removing <strong>{domain.domain}</strong> releases the hostname immediately. Click
                &quot;Confirm removal&quot; to proceed.
              </p>
            ) : null}
          </fieldset>
        </>
      )}
    </section>
  )
}
