export function compactTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  const m = n / 1_000_000
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`
}

/** `≈ $0.94`. Small non-zero amounts must not round away to `$0.00`. */
export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return '≈ <$0.01'
  return `≈ $${usd.toFixed(2)}`
}

/** A model id short enough for a row: `claude-opus-5` reads as `opus-5`. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

export function agoLabel(iso: string | null): string {
  if (iso === null) return ''
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(s) || s < 0) return ''
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
