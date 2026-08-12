import {
  BOOKKEEPING_TYPES, CONTENT_TYPES,
  type ParseStats, type Role, type ToolCall, type TranscriptEntry,
} from './types.js'

/** Tool input keys that carry a file path, in priority order. */
const FILE_PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path']

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function toolCallFrom(block: Record<string, unknown>): ToolCall | null {
  const id = str(block.id)
  const name = str(block.name)
  if (!id || !name) return null
  const input = (block.input ?? {}) as Record<string, unknown>
  let filePath: string | null = null
  for (const key of FILE_PATH_KEYS) {
    const found = str(input[key])
    if (found) { filePath = found; break }
  }
  return { id, name, filePath }
}

/** Pulls visible text and tool calls out of a message body of any known shape. */
function extractContent(message: unknown): { text: string | null; toolCalls: ToolCall[] } {
  const body = (message ?? {}) as Record<string, unknown>
  const content = body.content

  if (typeof content === 'string') {
    return { text: content.length > 0 ? content : null, toolCalls: [] }
  }
  if (!Array.isArray(content)) return { text: null, toolCalls: [] }

  const texts: string[] = []
  const toolCalls: ToolCall[] = []
  for (const raw of content) {
    if (typeof raw !== 'object' || raw === null) continue
    const block = raw as Record<string, unknown>
    switch (block.type) {
      case 'text': {
        const t = str(block.text)
        if (t) texts.push(t)
        break
      }
      case 'tool_use': {
        const call = toolCallFrom(block)
        if (call) toolCalls.push(call)
        break
      }
      // 'thinking', 'tool_result', 'image' and anything newer are intentionally dropped.
      default:
        break
    }
  }
  return { text: texts.length > 0 ? texts.join('\n') : null, toolCalls }
}

/**
 * Parses one JSONL line. Returns null for anything we cannot confidently read —
 * invalid JSON, bookkeeping lines, unknown future types, or content lines
 * missing the fields we need. Never throws: the transcript format is internal
 * to Claude Code and documented to change between releases.
 */
export function parseLine(raw: string): TranscriptEntry | null {
  if (raw.trim().length === 0) return null

  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    obj = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const type = obj.type
  if (typeof type !== 'string') return null
  if (!(CONTENT_TYPES as readonly string[]).includes(type)) return null

  const uuid = str(obj.uuid)
  const sessionId = str(obj.sessionId) ?? str(obj.session_id)
  const timestamp = str(obj.timestamp)
  if (!uuid || !sessionId || !timestamp) return null

  const { text, toolCalls } = extractContent(obj.message)
  const systemContent = type === 'system' ? str(obj.content) : null

  return {
    uuid,
    parentUuid: str(obj.parentUuid),
    sessionId,
    timestamp,
    role: type as Role,
    isSidechain: obj.isSidechain === true,
    cwd: str(obj.cwd),
    gitBranch: str(obj.gitBranch),
    version: str(obj.version),
    text: text ?? systemContent,
    toolCalls,
    isMeta: obj.isMeta === true,
  }
}

type SkipReason = 'unknown' | 'bookkeeping' | 'invalid'

/** Classifies a line we could not turn into an entry: expected noise vs format drift. */
function classifySkip(raw: string): SkipReason {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'invalid'
  }
  if (typeof parsed !== 'object' || parsed === null) return 'invalid'
  const type = (parsed as Record<string, unknown>).type
  if (typeof type !== 'string') return 'invalid'
  if ((BOOKKEEPING_TYPES as readonly string[]).includes(type)) return 'bookkeeping'
  // A content type that failed to parse was missing fields we require.
  if ((CONTENT_TYPES as readonly string[]).includes(type)) return 'invalid'
  return 'unknown'
}

export function parseLines(raws: string[]): { entries: TranscriptEntry[]; stats: ParseStats } {
  const entries: TranscriptEntry[] = []
  const versions = new Set<string>()
  let skippedUnknown = 0
  let skippedBookkeeping = 0
  let skippedInvalid = 0

  for (const raw of raws) {
    if (raw.trim().length === 0) continue
    const entry = parseLine(raw)
    if (entry) {
      entries.push(entry)
      if (entry.version) versions.add(entry.version)
      continue
    }
    switch (classifySkip(raw)) {
      case 'unknown': skippedUnknown++; break
      case 'bookkeeping': skippedBookkeeping++; break
      default: skippedInvalid++
    }
  }

  return {
    entries,
    stats: { parsed: entries.length, skippedUnknown, skippedBookkeeping, skippedInvalid, versions: [...versions] },
  }
}
