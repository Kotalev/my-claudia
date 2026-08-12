# Tasks

## Todo

- [ ] **T-005** WebSocket `/api/events` pushing `session.updated`; Overview screen with project cards + live session status `#m1` `#p1`
- [ ] **T-006** Session view: parsed timeline with auto-follow tail for active sessions `#m1` `#p2`
- [ ] **T-007** M1 smoke test: dashboard shows a real live Claude Code session end-to-end; write findings into Progress log `#m1` `#p1`
- [ ] **T-008** TASKS.md parser + serializer in `src/tasks/` with round-trip test (SPEC §5 format) `#m2` `#p1`
- [ ] **T-009** Task board UI (todo / in progress / done) + new-task form; `POST`/`PATCH` task endpoints writing line-based edits to TASKS.md `#m2` `#p1`
- [ ] **T-010** Watch TASKS.md per project; push `task.updated` over WebSocket `#m2` `#p2`
- [ ] **T-011** Dispatcher: `claude -p ... --cwd <project> --output-format stream-json`, capture session id, stream output to UI, 1-per-project concurrency guard `#m3` `#p1`
- [ ] **T-012** "Run with Claude" button on a task; generated prompt references the task id and TASKS.md update rules `#m3` `#p2`
- [ ] **T-013** Hook sink `POST /api/hooks` + fail-silent `scripts/hook-post.sh` (1s timeout, always exit 0) `#m4` `#p1`
- [ ] **T-014** Hook installer: merge SessionStart/Stop/SessionEnd/PostToolUse hooks into a target project's `.claude/settings.json` with backup; hooks become primary status source, watcher fallback `#m4` `#p2`
- [ ] **T-015** Final v1 review, port Claude Code setup (.claude/rules + hooks), README, v1 acceptance pass `#m4` `#p1`

## In progress

## Done

- [x] **T-004** SessionWatcher: chokidar on `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/**`, incremental tail by byte offset, per-session summary (status, last activity, files touched) `#m1` `#p1` (2026-08-12)
- [x] **T-003** Defensive transcript parser in `src/transcript/`: extract timestamp, role, text, tool calls, file paths; skip unknown lines; Vitest with real + malformed fixtures `#m1` `#p1` (2026-08-12)
- [x] **T-002** Project registry: `projects.json` (list of real project paths), `GET/POST /api/projects`, escaped-dir matching per SPEC §3.1 `#m1` `#p1` (2026-08-12)
- [x] **T-001** Scaffold repo: TypeScript strict, Fastify, Vite+React+Tailwind, Vitest, eslint; `npm run dev` serves a hello page on 127.0.0.1:4517 `#m1` `#p1` (2026-08-12)

## Progress log

- 2026-08-12 11:27 T-004 — Watcher live: 54 sessions, this one active. chokidar 5 has no globs; bounded backfill (7d/1MB) added.
- 2026-08-12 11:23 T-003 — Parser done: 14 line types seen in real data, 3 skip buckets, thinking never surfaced. 11 tests.
- 2026-08-12 11:22 T-002 — Registry + GET/POST /api/projects working; escaped-dir derived, corrupt store tolerated.
- 2026-08-12 11:21 T-001 — Scaffold done: TS strict, Fastify 4517, Vite 4518 proxy, Tailwind, Vitest 6/6, lint clean.
- 2026-08-12 11:20 T-015 — Added: final review + Claude setup port + README, discovered while planning.
- 2026-08-12 11:15 — Build design spec + implementation plan written (docs/superpowers/). Research: hooks beat transcripts for live status.
- 2026-08-12 — Backlog created from SPEC.md milestones (M1 visibility → M2 tasks → M3 dispatch → M4 hooks). Start with T-001.
