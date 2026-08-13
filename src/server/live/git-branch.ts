import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * A branch changes on checkout, not per keystroke; ten seconds keeps the reads
 * off the hot path while a `git switch` still shows up within one refresh.
 */
const TTL_MS = 10_000

const cache = new Map<string, { at: number; branch: string | null }>()

/** Tests only: the cache is module state and must not leak between cases. */
export function clearGitBranchCache(): void {
  cache.clear()
}

/**
 * Where HEAD lives for this checkout. `.git` is a directory in a normal repo;
 * in a worktree it is a file reading `gitdir: <path>`, and HEAD lives in that
 * directory instead. The path may be relative to the checkout.
 */
function headPath(cwd: string): string | null {
  const dotGit = join(cwd, '.git')
  if (statSync(dotGit).isDirectory()) return join(dotGit, 'HEAD')
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))
  if (!m?.[1]) return null
  return join(isAbsolute(m[1]) ? m[1] : resolve(cwd, m[1]), 'HEAD')
}

function branchFromHead(head: string): string | null {
  const line = head.split('\n', 1)[0]?.trim() ?? ''
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(line)
  if (ref?.[1]) return ref[1]
  // Detached HEAD is a bare commit sha; the short form is what git itself shows.
  if (/^[0-9a-f]{40}$/.test(line)) return line.slice(0, 7)
  return null
}

/**
 * The current git branch of `cwd`, read straight from `.git/HEAD` — no
 * child_process, so it can run on every summary. Null for anything that is not
 * a readable checkout: a missing directory, a bare path, a mangled HEAD. Never
 * throws — the caller is assembling a session summary, and "no branch" is an
 * answer where an exception is an outage.
 */
export function gitBranch(cwd: string, now = Date.now()): string | null {
  const hit = cache.get(cwd)
  if (hit && now - hit.at < TTL_MS) return hit.branch
  let branch: string | null = null
  try {
    const head = headPath(cwd)
    if (head !== null) branch = branchFromHead(readFileSync(head, 'utf8'))
  } catch {
    branch = null
  }
  cache.set(cwd, { at: now, branch })
  return branch
}
