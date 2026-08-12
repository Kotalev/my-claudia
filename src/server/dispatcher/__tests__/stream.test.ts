import { describe, it, expect } from 'vitest'
import { renderStreamLine } from '../stream.js'

describe('renderStreamLine', () => {
  it('announces the session on the init event', () => {
    expect(renderStreamLine('{"type":"system","subtype":"init","session_id":"abc"}'))
      .toBe('▸ session abc')
  })

  it('drops token-counter noise', () => {
    expect(renderStreamLine('{"type":"system","subtype":"thinking_tokens","estimated_tokens":50}'))
      .toBeNull()
  })

  it('shows assistant text', () => {
    const line = '{"type":"assistant","message":{"content":[{"type":"text","text":"Working on it"}]}}'
    expect(renderStreamLine(line)).toBe('Working on it')
  })

  it('never shows thinking content', () => {
    const line = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"secret plan"}]}}'
    expect(renderStreamLine(line)).toBeNull()
  })

  it('summarises a tool call with its file path', () => {
    const line = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/p/a.md"}}]}}'
    expect(renderStreamLine(line)).toBe('  ⚙ Write /p/a.md')
  })

  it('summarises a bash tool call with its command', () => {
    const line = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}'
    expect(renderStreamLine(line)).toBe('  ⚙ Bash npm test')
  })

  it('drops tool results, which are usually long and uninteresting here', () => {
    const line = '{"type":"user","message":{"content":[{"type":"tool_result","content":"...500 lines..."}]}}'
    expect(renderStreamLine(line)).toBeNull()
  })

  it('reports the final result with turns and cost', () => {
    const line = '{"type":"result","subtype":"success","num_turns":6,"total_cost_usd":0.736061}'
    expect(renderStreamLine(line)).toBe('▸ done · 6 turns · $0.736')
  })

  it('marks an errored result', () => {
    expect(renderStreamLine('{"type":"result","is_error":true}')).toBe('▸ error')
  })

  it('passes non-JSON through, since stderr matters', () => {
    expect(renderStreamLine('Error: command not found')).toBe('Error: command not found')
  })

  it('ignores blank lines', () => {
    expect(renderStreamLine('   ')).toBeNull()
  })

  it('returns nothing for an unknown future line type', () => {
    expect(renderStreamLine('{"type":"some_future_event","payload":1}')).toBeNull()
  })
})
