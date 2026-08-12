# Claude Mission Control

Local web dashboard for monitoring Claude Code sessions across projects and managing per-project task backlogs. Read `SPEC.md` before designing anything — it contains the architecture, verified platform facts, and the TASKS.md format. Do not re-derive decisions that SPEC.md already makes; if you believe a decision is wrong, say so explicitly and propose a change instead of silently diverging.

## Task workflow (important)

- `TASKS.md` in this repo is the single source of truth for what to work on. At the start of a session, read it and pick the highest-priority unblocked task from **Todo** unless the user says otherwise.
- When you start a task: move it to **In progress**, change `[ ]` to `[~]`, append a line to **Progress log**.
- While working: append a Progress log line after each meaningful milestone (newest first, format: `- YYYY-MM-DD HH:MM T-NNN — what happened`). Keep lines under ~120 chars.
- When done: move to **Done** with `[x]` and the date, append a final Progress log line.
- If you discover new work, add it as a new task with the next sequential `T-NNN` id — never reuse ids, never renumber.
- Do not put progress history in this file (CLAUDE.md); it belongs in TASKS.md.

## Domain terms

Used precisely throughout the code — if you mean one of these, use the word.

| Term | Meaning |
|---|---|
| **session** | One Claude Code conversation, identified by a UUID. Backed by one JSONL transcript file. |
| **transcript** | The append-only JSONL file at `<claude dir>/projects/<escaped dir>/<session>.jsonl`. Internal format, changes between releases. |
| **entry** | One parsed conversation line: role, text, tool calls. Bookkeeping lines are not entries. |
| **escaped dir** | A project path with every non-alphanumeric character replaced by `-`. Lossy, so not reversible — match by re-escaping a registered path. |
| **tail state** | Per-file `{byteOffset, partial}`. chokidar events are only a poke; growth is decided by comparing size against the offset. |
| **backfill** | The bounded initial read of a transcript we have never seen. Old or huge files are joined near their end, which sets `historyTruncated`. |
| **drift** | A transcript line whose `type` we have never seen. Counted and surfaced, never fatal. |
| **snapshot** | Full state pushed to a client on connect. Carries the current sequence rather than advancing it. |
| **delta** | An incremental event carrying the next sequence number. A gap makes the client ask for a fresh snapshot. |
| **run** | One dispatched headless `claude -p` process, tracked by a `RunHandle`. |
| **hook sink** | `POST /api/hooks`, where the forwarder delivers hook events. Always answers 200, even to garbage. |

## Stack & conventions

- Node 20+, TypeScript strict mode. Fastify for API + WebSocket, chokidar for file watching, React + Vite + Tailwind for the frontend, Vitest for tests. Single process, binds to `127.0.0.1:4517` only.
- Layout: `src/server/` (API, watcher, dispatcher), `src/transcript/` (JSONL parsing — ALL transcript format assumptions live here and nowhere else), `src/tasks/` (TASKS.md parse/serialize), `web/` (frontend), `scripts/` (hook helper scripts), `test/fixtures/` (real anonymized transcript samples).
- The transcript JSONL format is internal to Claude Code and changes between releases (the official docs say so). The parser must tolerate and skip unknown line shapes without crashing — never assume the fixture format is exhaustive. Prefer hook events over transcript parsing wherever both are available.
- Resolve the Claude data dir as `${CLAUDE_CONFIG_DIR:-~/.claude}` — never hardcode `~/.claude`.
- Never modify anything under the Claude data dir. The only exception: the opt-in hook installer may edit a target project's `.claude/settings.local.json`, and must back it up first.
- Hook helper scripts must be fail-silent: 1s timeout, always exit 0. Breaking the user's Claude Code sessions is the worst possible bug in this project.
- Dispatcher: pass task text as a single argv element to `claude` — no shell string interpolation.

## Testing & verification

- Every parser (transcript, TASKS.md) gets Vitest coverage including malformed-input cases before it is considered done.
- TASKS.md writer must round-trip: parse → serialize → parse yields identical structure; there is a test for this.
- Manual smoke test for watcher features: run the dev server, open a real Claude Code session in another terminal, confirm it appears in the dashboard.

## Commands

- `npm run dev` — dev server (API + Vite)
- `npm test` — Vitest
- `npm run lint` — eslint + tsc --noEmit
