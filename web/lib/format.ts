export function formatTokens(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString()
}

export function formatCompactTokens(value: number | null | undefined): string {
  const amount = Number(value ?? 0)
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1).replace(/\.0$/, "")}M`
  }
  if (amount >= 1_000) {
    const thousands = amount / 1_000
    return `${thousands >= 100 ? thousands.toFixed(0) : thousands.toFixed(1).replace(/\.0$/, "")}k`
  }
  return amount.toLocaleString()
}

export function formatDate(value: string | number | null | undefined): string {
  if (value == null) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatRelativeTime(
  value: string | number | null | undefined
): string {
  if (value == null) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const deltaMs = Date.now() - date.getTime()
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? "1h ago" : `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return days === 1 ? "today" : `${days}d ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return formatDate(value)
}

export function formatDuration(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.round(seconds / 86_400)
    return `${days}d`
  }
  if (seconds >= 3_600) {
    const hours = Math.round(seconds / 3_600)
    return `${hours}h`
  }
  return `${Math.round(seconds / 60)}m`
}
