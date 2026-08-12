/**
 * Renders `claude -p --output-format stream-json` lines as short readable text.
 *
 * This is the *headless output* format, which is a documented public interface —
 * distinct from the internal transcript JSONL whose assumptions live in
 * src/transcript/. It is still treated defensively: an unrecognised line yields
 * nothing rather than an error.
 */
export function renderStreamLine(raw: string): string | null {
  const line = raw.trim()
  if (line.length === 0) return null

  let msg: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) return null
    msg = parsed as Record<string, unknown>
  } catch {
    // Not JSON at all — most likely a stderr line worth showing verbatim.
    return line
  }

  switch (msg.type) {
    case 'system':
      return msg.subtype === 'init' ? `▸ session ${String(msg.session_id ?? '?')}` : null

    case 'assistant': {
      const content = (msg.message as { content?: unknown } | undefined)?.content
      if (!Array.isArray(content)) return null
      const parts: string[] = []
      for (const raw of content) {
        if (typeof raw !== 'object' || raw === null) continue
        const block = raw as Record<string, unknown>
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          parts.push(block.text.trim())
        } else if (block.type === 'tool_use') {
          const input = (block.input ?? {}) as Record<string, unknown>
          const target = typeof input.file_path === 'string' ? ` ${input.file_path}`
            : typeof input.command === 'string' ? ` ${input.command}`
            : ''
          parts.push(`  ⚙ ${String(block.name ?? 'tool')}${target}`)
        }
      }
      return parts.length > 0 ? parts.join('\n') : null
    }

    case 'result': {
      const ok = msg.is_error === true ? 'error' : 'done'
      const cost = typeof msg.total_cost_usd === 'number' ? ` · $${msg.total_cost_usd.toFixed(3)}` : ''
      const turns = typeof msg.num_turns === 'number' ? ` · ${msg.num_turns} turns` : ''
      return `▸ ${ok}${turns}${cost}`
    }

    // Token counters, rate-limit notices, tool results and anything newer are noise here.
    default:
      return null
  }
}
