import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveClaudeDir, escapeProjectPath, projectsDir, PORT, HOST } from '../config.js'

describe('resolveClaudeDir', () => {
  afterEach(() => { delete process.env.CLAUDE_CONFIG_DIR })

  it('defaults to ~/.claude', () => {
    expect(resolveClaudeDir()).toBe(join(homedir(), '.claude'))
  })

  it('honours CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/custom/claude'
    expect(resolveClaudeDir()).toBe('/custom/claude')
  })

  it('puts the projects dir under the resolved claude dir', () => {
    process.env.CLAUDE_CONFIG_DIR = '/custom/claude'
    expect(projectsDir()).toBe('/custom/claude/projects')
  })
})

describe('escapeProjectPath', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(escapeProjectPath('/Users/ivan/Projects/my-claudia'))
      .toBe('-Users-ivan-Projects-my-claudia')
  })

  it('replaces dots and underscores too', () => {
    expect(escapeProjectPath('/a/b_c.d')).toBe('-a-b-c-d')
  })
})

it('binds loopback only', () => {
  expect(HOST).toBe('127.0.0.1')
  expect(PORT).toBe(4517)
})
