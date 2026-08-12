export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500 animate-pulse',
  idle: 'bg-amber-500',
  done: 'bg-neutral-600',
}
