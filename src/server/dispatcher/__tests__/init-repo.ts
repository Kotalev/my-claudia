import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exec = promisify(execFile)

/** A real throwaway git repo with one committed file, for worktree tests. */
export async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-repo-'))
  await exec('git', ['-C', dir, 'init', '-q'])
  await exec('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test'])
  await exec('git', ['-C', dir, 'config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'file.txt'), 'one\ntwo\n')
  await exec('git', ['-C', dir, 'add', 'file.txt'])
  await exec('git', ['-C', dir, 'commit', '-q', '-m', 'init'])
  return dir
}
