/**
 * Git worktree isolation for dispatched runs.
 *
 * Every git invocation here is `spawn('git', [...argv])` with an explicit `-C`
 * target — never a shell string. Nothing in this module runs a destructive
 * command against the user's own checkout: worktree add/remove/prune only ever
 * touch the linked worktrees this dashboard created under `.worktrees/`. The
 * one command that changes the user's checkout — the guarded merge — lives in
 * the merge route, not here.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RunDiffFile } from '../../shared/types.js'

export interface GitResult {
  code: number | null
  stdout: string
  stderr: string
}

const GIT_TIMEOUT_MS = 30_000

/** Runs git with an argv array (no shell). Resolves with the exit code, never rejects. */
export function git(args: string[]): Promise<GitResult> {
  return new Promise(resolvePromise => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS)
    child.on('error', err => {
      clearTimeout(timer)
      resolvePromise({ code: null, stdout, stderr: String(err) })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

/**
 * Cheap repo detection: a `.git` entry in the project root (a directory for a
 * normal checkout, a file for a linked worktree). No process spawned.
 */
export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

/** Branch name for a run: `mc/run-<first 8 chars of the run id>`. */
export function runBranch(runId: string): string {
  return `mc/run-${runId.slice(0, 8)}`
}

/**
 * Commits whatever is pending in a run's worktree onto the run branch, so a
 * merge delivers exactly what the review diff showed — runs are not required
 * to commit their own work. The worktree is automation-owned by construction:
 * staging everything there touches nothing of the user's checkout. No-op when
 * clean. The identity flags keep the commit working on machines without a
 * global git identity.
 */
export async function commitPendingChanges(worktreeDir: string): Promise<GitResult> {
  const status = await git(['-C', worktreeDir, 'status', '--porcelain'])
  if (status.code !== 0) return status
  if (status.stdout.trim() === '') return { code: 0, stdout: '', stderr: '' }
  const add = await git(['-C', worktreeDir, 'add', '--all'])
  if (add.code !== 0) return add
  return git([
    '-C', worktreeDir,
    '-c', 'user.email=mission-control@localhost', '-c', 'user.name=mission-control',
    'commit', '-m', 'mc: run changes left uncommitted at review time',
  ])
}

/**
 * Creates a linked worktree for a run under `worktreesRoot/<runId>`, on a new
 * branch off the project's current HEAD. Throws with git's own stderr when the
 * repo refuses (unborn HEAD, branch collision, …).
 */
export async function createWorktree(
  projectPath: string,
  worktreesRoot: string,
  runId: string,
): Promise<{ branch: string; dir: string; base: string | null }> {
  const branch = runBranch(runId)
  const dir = join(worktreesRoot, runId)
  await mkdir(worktreesRoot, { recursive: true })
  // The branch point, recorded now: the review diff must cover everything the
  // run produced — commits included — not just what is uncommitted at read time.
  const baseRes = await git(['-C', projectPath, 'rev-parse', 'HEAD'])
  const base = baseRes.code === 0 ? baseRes.stdout.trim() : null
  const res = await git(['-C', projectPath, 'worktree', 'add', '-b', branch, dir])
  if (res.code !== 0) {
    throw new Error(`could not create worktree: ${res.stderr.trim() || res.stdout.trim() || 'git failed'}`)
  }
  return { branch, dir, base }
}

/** Untracked files larger than this are listed in `files` but their content stays out of the patch. */
const SMALL_UNTRACKED_BYTES = 64 * 1024

/** Per-file counts from `git diff --numstat` output. Binary files report "-", which reads as 0. */
export function parseNumstat(stdout: string): RunDiffFile[] {
  const files: RunDiffFile[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [additions, deletions, ...rest] = line.split('\t')
    files.push({
      path: rest.join('\t'),
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0,
    })
  }
  return files
}

/**
 * The run's changes relative to the branch point: `diff <base>` (working tree
 * against the recorded base commit, so the run's own commits are included) for
 * the patch, a `--numstat` pass for per-file counts, and
 * `status --porcelain -uall` for untracked files, whose content joins the
 * patch only when small. Without a usable base it degrades to `diff HEAD` —
 * uncommitted changes only.
 */
export async function collectDiff(
  worktreeDir: string,
  base?: string | null,
): Promise<{ files: RunDiffFile[]; patch: string }> {
  let ref = base ?? 'HEAD'
  if (ref !== 'HEAD' && (await git(['-C', worktreeDir, 'rev-parse', '--verify', `${ref}^{commit}`])).code !== 0) {
    ref = 'HEAD'
  }
  const [patchRes, numstat, status] = await Promise.all([
    git(['-C', worktreeDir, 'diff', ref]),
    git(['-C', worktreeDir, 'diff', ref, '--numstat']),
    git(['-C', worktreeDir, 'status', '--porcelain', '-uall']),
  ])

  const files = parseNumstat(numstat.stdout)

  let patch = patchRes.code === 0 ? patchRes.stdout : ''
  const appendPatch = (text: string): void => {
    if (patch && !patch.endsWith('\n')) patch += '\n'
    patch += text
  }

  for (const line of status.stdout.split('\n')) {
    if (!line.startsWith('?? ')) continue
    const path = line.slice(3)
    // git quotes paths with special characters; those are listed but not read.
    const quoted = path.startsWith('"')
    const info = quoted ? null : await stat(join(worktreeDir, path)).catch(() => null)
    if (info?.isFile() && info.size <= SMALL_UNTRACKED_BYTES) {
      const content = await readFile(join(worktreeDir, path), 'utf8').catch(() => null)
      if (content !== null) {
        const lines = content.length === 0 ? [] : content.replace(/\n$/, '').split('\n')
        files.push({ path, additions: lines.length, deletions: 0 })
        appendPatch(
          `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n`
          + lines.map(l => `+${l}\n`).join(''),
        )
        continue
      }
    }
    files.push({ path, additions: 0, deletions: 0 })
    appendPatch(`# untracked, content not shown: ${path}\n`)
  }

  return { files, patch }
}

/**
 * Removes a run's worktree via the owning repo. Tries a plain remove first;
 * `force` allows the `--force` retry when the tree is dirty — callers pass it
 * only once the work is either merged or explicitly discarded. The branch is
 * never touched: branches are never deleted here.
 */
export async function removeWorktree(projectPath: string, dir: string, force: boolean): Promise<GitResult> {
  const plain = await git(['-C', projectPath, 'worktree', 'remove', dir])
  if (plain.code === 0 || !force) return plain
  return git(['-C', projectPath, 'worktree', 'remove', '--force', dir])
}

/**
 * Startup cleanup: every directory under `worktreesRoot` whose name is not a
 * tracked run id is an orphan from a previous server process. The orphan dir is
 * removed (only ever under `worktreesRoot`), then the owning repo — found via
 * the worktree's own `--git-common-dir` before deletion — gets a
 * `git worktree prune`. Fail-silent: a vanished repo must not block startup.
 */
export async function pruneStaleWorktrees(worktreesRoot: string, trackedRunIds: Set<string>): Promise<void> {
  const entries = await readdir(worktreesRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || trackedRunIds.has(entry.name)) continue
    const dir = join(worktreesRoot, entry.name)
    const common = await git(['-C', dir, 'rev-parse', '--git-common-dir'])
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    if (common.code === 0 && common.stdout.trim()) {
      await git(['--git-dir', resolve(dir, common.stdout.trim()), 'worktree', 'prune'])
    }
  }
}
