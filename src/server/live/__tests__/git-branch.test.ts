import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitBranch, clearGitBranchCache } from '../git-branch.js'

const SHA = 'a3f9c2e18b47d6051f2c9ab34de78f0123456789'

let dir: string

async function repo(head: string): Promise<string> {
  const cwd = await mkdtemp(join(dir, 'repo-'))
  await mkdir(join(cwd, '.git'))
  await writeFile(join(cwd, '.git', 'HEAD'), head)
  return cwd
}

beforeEach(async () => {
  clearGitBranchCache()
  dir = await mkdtemp(join(tmpdir(), 'git-branch-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('gitBranch', () => {
  it('reads the branch of a normal checkout', async () => {
    const cwd = await repo('ref: refs/heads/main\n')
    expect(gitBranch(cwd)).toBe('main')
  })

  it('keeps slashes in the branch name', async () => {
    const cwd = await repo('ref: refs/heads/feat/live-rows\n')
    expect(gitBranch(cwd)).toBe('feat/live-rows')
  })

  it('follows a worktree .git file to its gitdir', async () => {
    const gitdir = join(dir, 'main-repo', '.git', 'worktrees', 'wt')
    await mkdir(gitdir, { recursive: true })
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/wt-branch\n')
    const cwd = await mkdtemp(join(dir, 'worktree-'))
    await writeFile(join(cwd, '.git'), `gitdir: ${gitdir}\n`)
    expect(gitBranch(cwd)).toBe('wt-branch')
  })

  it('resolves a relative gitdir against the checkout', async () => {
    const gitdir = join(dir, 'rel', 'gitdir')
    await mkdir(gitdir, { recursive: true })
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/rel-branch\n')
    const cwd = join(dir, 'rel', 'checkout')
    await mkdir(cwd)
    await writeFile(join(cwd, '.git'), 'gitdir: ../gitdir\n')
    expect(gitBranch(cwd)).toBe('rel-branch')
  })

  it('shortens a detached HEAD to seven characters', async () => {
    const cwd = await repo(`${SHA}\n`)
    expect(gitBranch(cwd)).toBe(SHA.slice(0, 7))
  })

  it('returns null for a directory that does not exist', () => {
    expect(gitBranch(join(dir, 'nowhere'))).toBeNull()
  })

  it('returns null for a directory that is not a checkout', async () => {
    const cwd = await mkdtemp(join(dir, 'plain-'))
    expect(gitBranch(cwd)).toBeNull()
  })

  it('returns null for garbage in HEAD, without throwing', async () => {
    for (const garbage of ['', '\n', 'not a ref at all', 'ref: refs/tags/v1', 'deadbeef']) {
      clearGitBranchCache()
      const cwd = await repo(garbage)
      expect(gitBranch(cwd)).toBeNull()
    }
  })

  it('returns null for a .git file whose gitdir line is mangled', async () => {
    const cwd = await mkdtemp(join(dir, 'wt-'))
    await writeFile(join(cwd, '.git'), 'this is not a worktree pointer\n')
    expect(gitBranch(cwd)).toBeNull()
  })

  it('serves from cache within the TTL and re-reads after it', async () => {
    const cwd = await repo('ref: refs/heads/main\n')
    const t0 = Date.now()
    expect(gitBranch(cwd, t0)).toBe('main')
    await writeFile(join(cwd, '.git', 'HEAD'), 'ref: refs/heads/other\n')
    expect(gitBranch(cwd, t0 + 5_000)).toBe('main')     // still cached
    expect(gitBranch(cwd, t0 + 11_000)).toBe('other')   // TTL elapsed
  })
})
