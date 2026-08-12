import { apiFetch } from '../shared/api.js'
/**
 * Registers a project path. Returns the server's own message on failure and
 * null on success; the list refreshes from the `projects.updated` broadcast,
 * so nothing is inserted locally — the server's answer is what the tab shows.
 */
export async function registerPath(path: string): Promise<string | null> {
  try {
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (res.ok) return null
    const body = await res.json().catch(() => ({}))
    return typeof body.error === 'string' ? body.error : `the server answered ${res.status}`
  } catch {
    return 'the server is unreachable'
  }
}
