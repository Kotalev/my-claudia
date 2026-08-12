import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAccountEmail } from '../account.js'

describe('readAccountEmail', () => {
  let dir: string
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'account-'))
    process.env.CLAUDE_CONFIG_DIR = dir
  })
  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await rm(dir, { recursive: true, force: true })
  })

  async function write(content: string): Promise<void> {
    await writeFile(join(dir, '.claude.json'), content)
  }

  it('reads oauthAccount.emailAddress', async () => {
    await write(JSON.stringify({ oauthAccount: { emailAddress: 'ivan@example.com' } }))
    expect(readAccountEmail()).toBe('ivan@example.com')
  })

  it('returns null when the file does not exist', () => {
    expect(readAccountEmail()).toBeNull()
  })

  it('returns null when oauthAccount is missing', async () => {
    await write(JSON.stringify({ numStartups: 3 }))
    expect(readAccountEmail()).toBeNull()
  })

  it('returns null when emailAddress is not a string', async () => {
    await write(JSON.stringify({ oauthAccount: { emailAddress: 42 } }))
    expect(readAccountEmail()).toBeNull()
  })

  it('returns null on garbage JSON instead of throwing', async () => {
    await write('{ definitely not json')
    expect(readAccountEmail()).toBeNull()
  })

  it('returns null when the top level is not an object', async () => {
    await write('"just a string"')
    expect(readAccountEmail()).toBeNull()
  })
})
