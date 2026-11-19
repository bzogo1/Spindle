import { ApiError } from "@/lib/api/client"

function digestOf(error: unknown) {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest
    return typeof digest === "string" ? digest : ""
  }
  return ""
}

function requestIdOf(error: unknown) {
  if (error instanceof ApiError) return error.requestId ?? ""
  if (typeof error === "object" && error !== null) {
    const record = error as { requestId?: unknown; requestID?: unknown }
    if (typeof record.requestId === "string") return record.requestId
    if (typeof record.requestID === "string") return record.requestID
  }
  return ""
}

/** Stable support reference for an error without exposing its message. */
export function getErrorReference(error: unknown) {
  return requestIdOf(error) || digestOf(error)
}
