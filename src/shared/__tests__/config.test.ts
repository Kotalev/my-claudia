import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  resolveClaudeDir, escapeProjectPath, projectsDir, resolveHost, isLoopbackHost, PORT, HOST,
} from '../config.js'

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

it('binds loopback unless MC_HOST opts in', () => {
  expect(HOST).toBe('127.0.0.1')
  expect(PORT).toBe(4517)
})

describe('resolveHost', () => {
  it('defaults to loopback when MC_HOST is unset', () => {
    expect(resolveHost(undefined)).toBe('127.0.0.1')
  })

  it('uses MC_HOST when set', () => {
    expect(resolveHost('0.0.0.0')).toBe('0.0.0.0')
    expect(resolveHost('192.168.1.10')).toBe('192.168.1.10')
  })

  it('treats an empty or whitespace MC_HOST as unset, not as bind-everything', () => {
    expect(resolveHost('')).toBe('127.0.0.1')
    expect(resolveHost('   ')).toBe('127.0.0.1')
  })

  it('trims surrounding whitespace', () => {
    expect(resolveHost(' 192.168.1.10 ')).toBe('192.168.1.10')
  })
})

describe('isLoopbackHost', () => {
  it('recognises the loopback spellings', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
  })

  it('flags everything else as exposed', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('192.168.1.10')).toBe(false)
    expect(isLoopbackHost('')).toBe(false)
  })
})
