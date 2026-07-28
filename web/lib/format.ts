export function formatTokens(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString()
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
