const byteUnits = ["B", "KB", "MB", "GB", "TB"] as const

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const unitIndex = Math.min(byteUnits.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** unitIndex
  const rounded = unitIndex === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${byteUnits[unitIndex]}`
}

export function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function formatDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) {
    const rounded = Number.isInteger(seconds) ? seconds : Math.round(seconds * 10) / 10
    return `${rounded}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
}

export function formatRelativeTime(value: string, now = Date.now()) {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return value

  const diffMs = Math.max(0, now - time)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  return formatDate(value)
}
