import {
  BOOKKEEPING_TYPES, CONTENT_TYPES, INJECTED_MARKERS,
  type CompactBoundary, type EntryUsage, type ParseStats, type Role, type ToolCall,
  type TranscriptEntry,
} from './types.js'

/** The sentinel Claude Code writes for messages it generated without a model. */
export const SYNTHETIC_MODEL = '<synthetic>'

/**
 * Distinguishes something the user typed from machine content Claude Code
 * replays as a user turn. Anything wrapped in a known marker is machine text;
 * so is a turn that carried no text of its own (a tool result).
 */
function looksHumanTyped(text: string | null): boolean {
  if (text === null) return false
  const head = text.trimStart()
  return !INJECTED_MARKERS.some(marker => head.startsWith(marker))
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

/**
 * Reads the usage block off a message. Every field is optional: the shape has
 * already changed once within the versions on this machine (`output_tokens_details`
 * and the `cache_creation` split are both newer than the oldest transcripts), so
 * a missing field must read as zero rather than sink the line.
 */
function extractUsage(message: Record<string, unknown>): EntryUsage | null {
  const u = message.usage
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return null
  const raw = u as Record<string, unknown>
  const creation = obj(raw.cache_creation)
  const serverTools = obj(raw.server_tool_use)
  const details = obj(raw.output_tokens_details)

  const cc5 = num(creation.ephemeral_5m_input_tokens)
  const cc1h = num(creation.ephemeral_1h_input_tokens)
  // Older lines carry only the flat total and no split at all.
  const flatCreation = num(raw.cache_creation_input_tokens)

  return {
    inputTokens: num(raw.input_tokens),
    outputTokens: num(raw.output_tokens),
    cacheReadInputTokens: num(raw.cache_read_input_tokens),
    cacheCreationInputTokens: flatCreation > 0 ? flatCreation : cc5 + cc1h,
    cacheCreation5mInputTokens: cc5,
    cacheCreation1hInputTokens: cc1h,
    thinkingTokens: typeof details.thinking_tokens === 'number' ? num(details.thinking_tokens) : null,
    webSearchRequests: num(serverTools.web_search_requests),
    webFetchRequests: num(serverTools.web_fetch_requests),
    serviceTier: str(raw.service_tier),
    inferenceGeo: str(raw.inference_geo),
    speed: str(raw.speed),
  }
}

function optNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function extractCompact(o: Record<string, unknown>): CompactBoundary | null {
  if (o.subtype !== 'compact_boundary') return null
  const meta = obj(o.compactMetadata)
  return {
    trigger: str(meta.trigger),
    preTokens: optNum(meta.preTokens),
    postTokens: optNum(meta.postTokens),
    durationMs: optNum(meta.durationMs),
    cumulativeDroppedTokens: optNum(meta.cumulativeDroppedTokens),
  }
}

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

  const message = typeof obj.message === 'object' && obj.message !== null
    ? obj.message as Record<string, unknown>
    : {}
  const { text, toolCalls } = extractContent(obj.message)
  const systemContent = type === 'system' ? str(obj.content) : null
  const compact = extractCompact(obj)

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
    messageId: str(message.id),
    requestId: str(obj.requestId),
    model: str(message.model),
    usage: extractUsage(message),
    effort: str(obj.effort),
    isApiError: obj.isApiErrorMessage === true,
    isCompactBoundary: compact !== null,
    compact,
    isHumanPrompt:
      type === 'user' &&
      obj.isMeta !== true &&
      obj.isSidechain !== true &&
      // The summary Claude Code writes for itself after compacting is replayed as
      // a user turn. Showing it as the last thing the user said is wrong, and it
      // happens right when a session is most interesting to look at.
      obj.isCompactSummary !== true &&
      looksHumanTyped(text),
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
