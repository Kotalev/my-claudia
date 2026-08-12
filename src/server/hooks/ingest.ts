import { escapeProjectPath } from '../../shared/config.js'
import type { SessionSummary } from '../../shared/types.js'
import type { ProjectRegistry } from '../registry.js'
import type { SessionStore } from '../watcher/session-store.js'

export interface HookEvent {
  hook_event_name: string
  session_id: string
  cwd?: string
  transcript_path?: string
  permission_mode?: string
}

/**
 * Hook payloads are a documented public interface, but the event set grows
 * between releases, so an unknown event name is accepted rather than rejected.
 */
export function normalizeHookEvent(body: unknown): HookEvent | null {
  if (typeof body !== 'object' || body === null) return null
  const obj = body as Record<string, unknown>
  const name = obj.hook_event_name
  const session = obj.session_id
  if (typeof name !== 'string' || name.length === 0) return null
  if (typeof session !== 'string' || session.length === 0) return null

  return {
    hook_event_name: name,
    session_id: session,
    ...(typeof obj.cwd === 'string' ? { cwd: obj.cwd } : {}),
    ...(typeof obj.transcript_path === 'string' ? { transcript_path: obj.transcript_path } : {}),
    ...(typeof obj.permission_mode === 'string' ? { permission_mode: obj.permission_mode } : {}),
  }
}

export function applyHookEvent(
  store: SessionStore,
  registry: ProjectRegistry,
  event: HookEvent,
): SessionSummary | null {
  const project = event.cwd ? registry.byEscapedDir(escapeProjectPath(event.cwd)) ?? null : null

  // SessionEnd is the only event meaning the session is finished. Stop merely
  // ends a turn — the session stays alive waiting for the next prompt.
  if (event.hook_event_name === 'SessionEnd') store.markEnded(event.session_id)
  else store.markActive(event.session_id, project)

  return store.get(event.session_id) ?? null
}
