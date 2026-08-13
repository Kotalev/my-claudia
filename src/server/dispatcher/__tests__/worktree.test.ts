import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDiff, createWorktree, isGitRepo, pruneStaleWorktrees, runBranch } from '../worktree.js'
import { initRepo } from './init-repo.js'

const exec = promisify(execFile)

describe('isGitRepo', () => {
  it('detects a checkout and rejects a plain directory', async () => {
    const repo = await initRepo()
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    expect(isGitRepo(repo)).toBe(true)
    expect(isGitRepo(plain)).toBe(false)
  })
})

describe('runBranch', () => {
  it('uses the first 8 chars of the run id', () => {
    expect(runBranch('abcdef01-2345')).toBe('mc/run-abcdef01')
  })
})

describe('createWorktree', () => {
  it('creates a linked worktree on a new branch off HEAD', async () => {
    const repo = await initRepo()
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    const { branch, dir, base } = await createWorktree(repo, root, 'run-1234abcd')
    expect(dir).toBe(join(root, 'run-1234abcd'))
    expect(existsSync(join(dir, 'file.txt'))).toBe(true)
    const { stdout } = await exec('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])
    expect(stdout.trim()).toBe(branch)
    const head = await exec('git', ['-C', repo, 'rev-parse', 'HEAD'])
    expect(base).toBe(head.stdout.trim())
  })

  it('throws with git\'s reason when the target is not a repo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    await expect(createWorktree(plain, root, 'run-x')).rejects.toThrow(/could not create worktree/)
  })
})

describe('collectDiff', () => {
  it('reports tracked changes and small untracked files, with counts', async () => {
    const repo = await initRepo()
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    const { dir } = await createWorktree(repo, root, 'run-diff1')
    await writeFile(join(dir, 'file.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(dir, 'note.md'), 'hello\nworld\n')

    const { files, patch } = await collectDiff(dir)
    const tracked = files.find(f => f.path === 'file.txt')
    const untracked = files.find(f => f.path === 'note.md')
    expect(tracked).toEqual({ path: 'file.txt', additions: 1, deletions: 0 })
    expect(untracked).toEqual({ path: 'note.md', additions: 2, deletions: 0 })
    expect(patch).toContain('+three')
    expect(patch).toContain('+++ b/note.md')
    expect(patch).toContain('+hello')
  })

  it('lists a large untracked file without inlining its content', async () => {
    const repo = await initRepo()
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    const { dir } = await createWorktree(repo, root, 'run-diff2')
    await writeFile(join(dir, 'big.bin'), 'x'.repeat(70 * 1024))

    const { files, patch } = await collectDiff(dir)
    expect(files).toEqual([{ path: 'big.bin', additions: 0, deletions: 0 }])
    expect(patch).toContain('content not shown: big.bin')
    expect(patch).not.toContain('xxxxxxxxxx')
  })

  it('includes work the run already committed, not only the uncommitted tail', async () => {
    const repo = await initRepo()
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    const wt = await createWorktree(repo, root, 'run-diff4')
    await writeFile(join(wt.dir, 'hello.md'), 'hello\n')
    await exec('git', ['-C', wt.dir, 'add', 'hello.md'])
    await exec('git', ['-C', wt.dir, 'commit', '-q', '-m', 'add hello'])
    await writeFile(join(wt.dir, 'file.txt'), 'one\ntwo\nthree\n')

    const { files, patch } = await collectDiff(wt.dir, wt.base)
    expect(files.map(f => f.path).sort()).toEqual(['file.txt', 'hello.md'])
    expect(patch).toContain('+hello')
    expect(patch).toContain('+three')
  })

  it('falls back to HEAD when the recorded base is unusable', async () => {
    const repo = await initRepo()
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    const { dir } = await createWorktree(repo, root, 'run-diff5')
    await writeFile(join(dir, 'file.txt'), 'one\ntwo\nthree\n')
    const { files, patch } = await collectDiff(dir, 'not-a-commit')
    expect(files).toEqual([{ path: 'file.txt', additions: 1, deletions: 0 }])
    expect(patch).toContain('+three')
  })

  it('answers an untouched worktree with empty arrays, not an error', async () => {
    const repo = await initRepo()
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    const { dir } = await createWorktree(repo, root, 'run-diff3')
    expect(await collectDiff(dir)).toEqual({ files: [], patch: '' })
  })

  it('degrades to an empty diff on a directory that is not a repo at all', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    expect(await collectDiff(plain)).toEqual({ files: [], patch: '' })
  })
})

describe('pruneStaleWorktrees', () => {
  it('tolerates a missing worktrees root', async () => {
    await expect(pruneStaleWorktrees(join(tmpdir(), 'mc-nonexistent-root'), new Set())).resolves.toBeUndefined()
  })

  it('removes orphan worktrees and prunes the owning repo, keeping tracked ones', async () => {
    const repo = await initRepo()
    const root = await mkdtemp(join(tmpdir(), 'mc-wt-'))
    const stale = await createWorktree(repo, root, 'run-stale')
    const kept = await createWorktree(repo, root, 'run-kept')
    // A junk dir that never was a worktree must go too, without an error.
    await mkdir(join(root, 'run-junk'))

    await pruneStaleWorktrees(root, new Set(['run-kept']))

    expect(existsSync(stale.dir)).toBe(false)
    expect(existsSync(join(root, 'run-junk'))).toBe(false)
    expect(existsSync(kept.dir)).toBe(true)
    const { stdout } = await exec('git', ['-C', repo, 'worktree', 'list'])
    expect(stdout).not.toContain('run-stale')
    expect(stdout).toContain('run-kept')
    // Branches survive the prune — they are never deleted.
    const branches = await exec('git', ['-C', repo, 'branch', '--list', 'mc/run-*'])
    expect(branches.stdout).toContain(runBranch('run-stale'))
  })
})
