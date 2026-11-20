"use client"

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { Trash2, Upload } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { UserAvatar, type UserAvatarSize } from "@/components/app/user-avatar"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { ApiError, request } from "@/lib/api/client"
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, parseAvatarUpload, type AvatarRecord } from "@/lib/avatar"

/**
 * Avatar upload control for account settings: shows the current picture (or
 * initials), accepts a PNG/JPEG/WebP/GIF file up to 2 MB via click or drag,
 * validates it client-side with the same magic-byte rules the API enforces,
 * then PUTs the resulting `data:` URL to `/api/avatar`. Remove issues a
 * DELETE.
 */

const AVATAR_LABEL_ID = "account-avatar-label"

function fileToBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(file)
  })
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many uploads. Please wait a minute and try again."
    if (error.status === 401) return "Your session expired. Sign in again to update your avatar."
    return error.message || fallback
  }
  return fallback
}

export function AvatarUpload({
  name,
  size = "lg",
}: {
  /** Display name used for the initials fallback and alt text. */
  name: string
  size?: UserAvatarSize
}) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [avatar, setAvatar] = useState<AvatarRecord | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    request<{ avatar?: AvatarRecord | null }>("", "/api/avatar", {
      signal: controller.signal,
    })
      .then((body) => setAvatar(body.avatar ?? null))
      .catch(() => {
        // A missing avatar endpoint or expired session shouldn't break the
        // settings page — the control just starts empty.
      })
      .finally(() => setLoaded(true))
    return () => controller.abort()
  }, [])

  const uploadFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || busy) return
      setError("")

      let bytes: Uint8Array
      try {
        bytes = await fileToBytes(file)
      } catch {
        setError("We could not read that file. Try another image.")
        return
      }

      // Client-side pre-check with the same magic-byte validation the route
      // applies; the server still re-validates, so this is only for fast
      // feedback.
      const parsed = parseAvatarUpload({ bytes, declaredMime: file.type })
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }

      setBusy(true)
      try {
        const body = await request<{ avatar?: AvatarRecord }>("", "/api/avatar", {
          method: "PUT",
          body: { dataUrl: parsed.avatar.dataUrl },
        })
        if (body.avatar) setAvatar(body.avatar)
        toast({
          title: "Avatar updated",
          description: "Your new profile picture was saved.",
          variant: "success",
        })
      } catch (uploadError) {
        setError(errorMessage(uploadError, "We could not save that image. Please try again."))
      } finally {
        setBusy(false)
      }
    },
    [busy, toast],
  )

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    void uploadFile(event.target.files?.[0])
    event.target.value = ""
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragActive(false)
    void uploadFile(event.dataTransfer.files?.[0])
  }

  async function removeAvatar() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await request("", "/api/avatar", { method: "DELETE" })
      setAvatar(null)
      toast({ title: "Avatar removed", variant: "success" })
    } catch (removeError) {
      setError(errorMessage(removeError, "We could not remove your avatar. Please try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-field">
      <span className="app-field-label" id={AVATAR_LABEL_ID}>
        Avatar
      </span>
      <div className="app-avatar-row">
        <UserAvatar
          src={avatar?.dataUrl ?? null}
          name={name}
          size={size}
          alt={avatar ? `${name} avatar` : undefined}
        />
        <label
          className={`app-avatar-drop${dragActive ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <Upload aria-hidden="true" />
          <span>
            {busy
              ? "Uploading…"
              : dragActive
                ? "Drop the image here"
                : avatar
                  ? "Replace photo"
                  : "Drop an image or click to browse"}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            aria-labelledby={AVATAR_LABEL_ID}
            disabled={busy || !loaded}
            onChange={onInputChange}
          />
        </label>
        {avatar ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void removeAvatar()}
            disabled={busy}
          >
            <Trash2 aria-hidden="true" />
            {busy ? "Removing…" : "Remove"}
          </Button>
        ) : null}
      </div>
      <p className="app-field-hint">
        PNG, JPG, WebP, or GIF up to {Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))} MB.
      </p>
      {error ? <InlineError title={null} message={error} /> : null}
    </div>
  )
}
