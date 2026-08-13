#!/usr/bin/env node
// Stands in for `claude -p --input-format stream-json --output-format stream-json`.
// The prompt is NOT argv: user messages arrive as stdin lines and each one is
// answered with an echo + a result event, after which the process stays alive
// waiting for more input. Closing stdin makes it exit 0 — same as the real CLI.
// Emits startup noise BEFORE the init event, so the dispatcher must scan for it
// rather than assuming the first line carries the session id.
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok'

console.log(JSON.stringify({ type: 'system', subtype: 'hook_started', hook: 'SessionStart' }))
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session-123', model: 'claude-fable-5' }))
console.log(JSON.stringify({ type: 'assistant', argv: args, message: { content: [{ type: 'text', text: `args:${args.length}` }] } }))
// Resume tests read the flags back to prove --resume <id> reached argv.
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `argv:${args.join(' ')}` }] } }))
// Worktree isolation tests read this back to prove the run started in its own tree.
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `cwd:${process.cwd()}` }] } }))

if (mode === 'crash') process.exit(3)

const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  if (mode === 'hang') return // reads the message but never answers
  if (mode === 'rate-limited') {
    // What the real stream emits when the account hits a window, then a dead
    // process. resetsAt is epoch SECONDS. The write callback guards the flush:
    // on macOS pipe writes are async and exit() would truncate them.
    const event = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'rejected',
        resetsAt: Number(process.env.FAKE_CLAUDE_RESETS_AT ?? 1786607400),
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
      },
    })
    process.stdout.write(`${event}\n`, () => process.exit(2))
    return
  }
  if (mode === 'rate-limited-garbage') {
    // A malformed payload must not count as a rate limit — just a failed run.
    const event = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: 'nonsense' })
    process.stdout.write(`${event}\n`, () => process.exit(2))
    return
  }
  if (mode === 'garbage') {
    // Noise the real stream can contain: non-JSON, unknown types, rate limits.
    console.log('not json at all {{{')
    console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))
    console.log(JSON.stringify({ type: 'some_future_event', payload: [1, 2, 3] }))
  }
  let text = '(unparsed)'
  try {
    const msg = JSON.parse(line)
    text = msg.message.content[0].text
  } catch { /* echo the placeholder */ }
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `echo:${text}` }] } }))
  console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'fake-session-123', total_cost_usd: 0.01, num_turns: 6 }))
})
rl.on('close', () => process.exit(0))
