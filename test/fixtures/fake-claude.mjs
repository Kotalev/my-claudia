#!/usr/bin/env node
// Stands in for `claude -p --output-format stream-json` in tests.
// Emits startup noise BEFORE the init event, so the dispatcher must scan for it
// rather than assuming the first line carries the session id.
const args = process.argv.slice(2)
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok'

console.log(JSON.stringify({ type: 'system', subtype: 'hook_started', hook: 'SessionStart' }))
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session-123', model: 'claude-fable-5' }))
console.log(JSON.stringify({ type: 'assistant', argv: args, message: { content: [{ type: 'text', text: `args:${args.length}` }] } }))

if (mode === 'crash') process.exit(3)
if (mode === 'hang') { setInterval(() => {}, 1000) }
else {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'fake-session-123', total_cost_usd: 0.01 }))
  process.exit(0)
}
