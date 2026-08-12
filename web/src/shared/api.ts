/**
 * The server requires a token on every API request and on the WebSocket. It
 * arrives once via `?token=` in the dashboard URL (printed at server startup),
 * is kept in localStorage, and is stripped from the address bar so it does not
 * linger in screenshots or shared links.
 */
const STORAGE_KEY = 'mc-auth-token'

function initToken(): string {
  const params = new URLSearchParams(location.search)
  const fromUrl = params.get('token')
  if (fromUrl) {
    localStorage.setItem(STORAGE_KEY, fromUrl)
    params.delete('token')
    const query = params.toString()
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash)
    return fromUrl
  }
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

const token = initToken()

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), 'x-auth-token': token },
  })
}

export function wsUrl(): string {
  return `ws://${location.host}/ws?token=${encodeURIComponent(token)}`
}
