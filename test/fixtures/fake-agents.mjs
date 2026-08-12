#!/usr/bin/env node
// Stands in for `claude agents --json`. FAKE_AGENTS_MODE picks the failure to test.
const mode = process.env.FAKE_AGENTS_MODE ?? 'ok'
if (mode === 'crash') { console.error('boom'); process.exit(1) }
if (mode === 'garbage') { console.log('not json at all'); process.exit(0) }
if (mode === 'hang') { setTimeout(() => {}, 60_000); }
else {
  console.log(JSON.stringify([
    { id: 'fc039f19', cwd: '/Users/dev/Projects/pable', kind: 'background',
      // Recent on purpose: agents blocked for over a week are filtered out.
      startedAt: Date.now() - 3_600_000, sessionId: 'fc039f19-e199-4a4d-9123-6d1d6a4ca026',
      name: 'mobile-prp-1-foundations', state: 'blocked' },
    { pid: 10478, cwd: '/Users/dev/Projects/my-claudia', kind: 'interactive',
      startedAt: 1786522794850, sessionId: '13f5f648-f06d-47c9-b4ab-80730e9c0325',
      name: 'my-claudia', status: 'busy' },
  ]))
}
