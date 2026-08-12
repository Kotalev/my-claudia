# Tasks

## Todo


## In progress


## Done

- [x] **T-029** Capture `total_cost_usd` + `num_turns` onto `RunHandle` instead of only rendering them into a string; label "reported by claude" `#m7` `#p3` (2026-08-12)
- [x] **T-030** Statusline installer with backup + passthrough of the user's existing statusline; surfaces 5h/7d plan limits. Must never break a session `#m7` `#p2` (2026-08-12)
- [x] **T-031** Record in SPEC.md: process definition, liveness precedence, occupancy formula and its one-turn lag, dedup rule, pricing policy `#m5` `#p2` (2026-08-12)
- [x] **T-022** Transcript telemetry fields: `messageId`, `requestId`, `model`, `usage` (5m/1h cache split, thinking, web search), `effort`, `isApiError`. Fixtures: split-response same message.id, `<synthetic>`, legacy usage shape `#m6` `#p1` (2026-08-12)
- [x] **T-023** Parse `system`/`compact_boundary` + `compactMetadata` as a boundary marker, not a prompt; every subfield optional `#m6` `#p1` (2026-08-12)
- [x] **T-024** `SessionUsage` aggregation: dedupe by `messageId` taking max-per-field, drop `<synthetic>`/api-error lines, occupancy = last non-sidechain assistant turn, main vs subagent split. Tests: dedup, re-apply idempotence, empty → zeros not NaN `#m6` `#p1` (2026-08-12)
- [x] **T-025** `src/shared/pricing.ts`: model → rates + context windows + `PRICES_VERIFIED_ON`; unknown id → null, never 0 `#m6` `#p1` (2026-08-12)
- [x] **T-026** Context occupancy bar on live rows + session detail; unknown model → raw tokens and no bar; no assistant turn yet → em dash, never 0% `#m6` `#p1` (2026-08-12)
- [x] **T-027** Session detail telemetry panel: token table (main/subagents/total), compaction markers on the timeline, model-change and fallback surfacing `#m6` `#p2` (2026-08-12)
- [x] **T-028** Cost display: PAYG estimate at list prices, plus the no-cache counterfactual so the cache saving is visible. `≈` prefix, persistent "API-equivalent — subscription bills differently" qualifier, `n/a` for unpriced models `#m7` `#p1` (2026-08-12)
- [x] **T-016** Kill the hand-maintained web type mirror: vite `resolve.alias` for @shared/@transcript, rewrite `web/src/shared/types.ts` as re-exports, move `RunStatus`/`RunHandle` into `src/shared/types.ts` `#m5` `#p1` (2026-08-12)
- [x] **T-017** `src/server/live/sessions-registry.ts`: watch `<claude dir>/sessions/*.json` (never `*.key` — secrets), `LiveProcess` type, liveness via `kill(pid,0)` + `startedAt` match; tests: stale entry, garbage json, missing dir `#m5` `#p1` (2026-08-12)
- [x] **T-018** `claude agents --json` poller (30s, unref'd, spawn not shell, fail-silent). Only source of `kind:"background"` agents — they have no pid and no registry file. Merge by `sessionId` `#m5` `#p1` (2026-08-12)
- [x] **T-019** Wire live processes into SessionStore: `live` on `SessionSummary`, add `waiting` to `SessionStatus`, retype `STATUS_STYLES` as `Record<SessionStatus,string>` first, broadcast only changed `#m5` `#p1` (2026-08-12)
- [x] **T-020** Resolve a session's real project path without un-escaping (live `cwd` → newest transcript `cwd` → re-escaped `~/.claude.json` keys → "path unknown"); live sessions show regardless of registration `#m5` `#p1` (2026-08-12)
- [x] **T-021** Overview "Live" band: always present, waiting→busy→idle order, new processes appear with no reload, dead ones drop out; browser-verified `#m5` `#p1` (2026-08-12)
- [x] **T-015** Final v1 review, port Claude Code setup (.claude/rules + hooks), README, v1 acceptance pass `#m4` `#p1` (2026-08-12)
- [x] **T-014** Hook installer: merge SessionStart/Stop/SessionEnd/PostToolUse hooks into a target project's `.claude/settings.json` with backup; hooks become primary status source, watcher fallback `#m4` `#p2` (2026-08-12)
- [x] **T-013** Hook sink `POST /api/hooks` + fail-silent `scripts/hook-post.sh` `#m4` `#p1` (2026-08-12)
- [x] **T-012** "Run with Claude" button on a task; generated prompt references the task id and TASKS.md update rules `#m3` `#p2` (2026-08-12)
- [x] **T-011** Dispatcher: `claude -p ... --cwd <project> --output-format stream-json`, capture session id, stream output to UI, 1-per-project concurrency guard `#m3` `#p1` (2026-08-12)
- [x] **T-007** M1 smoke test: dashboard shows a real live Claude Code session end-to-end; write findings into Progress log `#m1` `#p1` (2026-08-12)
- [x] **T-010** Watch TASKS.md per project; push `task.updated` over WebSocket `#m2` `#p2` (2026-08-12)
- [x] **T-009** Task board UI (todo / in progress / done) + new-task form; `POST`/`PATCH` task endpoints writing line-based edits to TASKS.md `#m2` `#p1` (2026-08-12)
- [x] **T-008** TASKS.md parser + serializer in `src/tasks/` with round-trip test (SPEC §5 format) `#m2` `#p1` (2026-08-12)
- [x] **T-006** Session view: parsed timeline with auto-follow tail for active sessions `#m1` `#p2` (2026-08-12)
- [x] **T-005** WebSocket `/api/events` pushing `session.updated`; Overview screen with project cards + live session status `#m1` `#p1` (2026-08-12)
- [x] **T-004** SessionWatcher: chokidar on `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/**`, incremental tail by byte offset, per-session summary (status, last activity, files touched) `#m1` `#p1` (2026-08-12)
- [x] **T-003** Defensive transcript parser in `src/transcript/`: extract timestamp, role, text, tool calls, file paths; skip unknown lines; Vitest with real + malformed fixtures `#m1` `#p1` (2026-08-12)
- [x] **T-002** Project registry: `projects.json` (list of real project paths), `GET/POST /api/projects`, escaped-dir matching per SPEC §3.1 `#m1` `#p1` (2026-08-12)
- [x] **T-001** Scaffold repo: TypeScript strict, Fastify, Vite+React+Tailwind, Vitest, eslint; `npm run dev` serves a hello page on 127.0.0.1:4517 `#m1` `#p1` (2026-08-12)

## Progress log

- 2026-08-12 13:30 T-029 — Run cost and turn count captured from the result event instead of only rendered into text.
- 2026-08-12 13:20 T-031 — SPEC section 8 written: process definition, status precedence, dedup rule, occupancy, cost and plan-limit policy.
- 2026-08-12 13:15 T-030 — Statusline installed at project scope with passthrough; 66ms with the dashboard down, exit 0 on a broken passthrough.
- 2026-08-12 13:00 T-026..T-028 — Telemetry live in browser: 222k/1.0M bar, $44.31 PAYG vs $180.77 uncached, subagent split.
- 2026-08-12 12:57 T-025 — Prices verified first-hand against the pricing doc; Opus 4.8 is $5/$25. Unknown model costs null, never zero.
- 2026-08-12 12:54 T-024 — Usage aggregation validated on real data: 1864 lines -> 365 messages, dedup by message.id not uuid.
- 2026-08-12 12:50 T-022/T-023 — Parser reads usage, model, effort, compact boundaries. iterations is an array, never a count.
- 2026-08-12 12:48 — Parser bug: isCompactSummary lines were counted as human prompts; 190 compactions across the corpus.
- 2026-08-12 12:45 T-021 — Live band verified in browser: 4 real processes, 2 background agents shown as waiting. Console clean.
- 2026-08-12 12:43 — Parser bug found via the live band: <task-notification> counted as a human prompt. 1085 such lines across 262 transcripts.
- 2026-08-12 12:40 T-017..T-020 — Live sources wired: sessions registry + agents poller merged by sessionId; status gains `waiting`.
- 2026-08-12 12:36 T-016 — Web type mirror deleted; vite aliases into src/. Types can no longer drift silently.
- 2026-08-12 12:30 — v2 decided: subscription + PAYG-estimate cost, statusline with passthrough, live-only discovery. M5-M7 queued.
- 2026-08-12 12:28 — Research: ~/.claude/sessions/<pid>.json is a real live-session registry (pid, cwd, status busy|waiting).
- 2026-08-12 12:28 — Research: `claude agents --json` is the only source of background agents; they have no pid and no registry file.
- 2026-08-12 12:15 T-015 — v1 complete. 163 tests, lint clean, acceptance in docs/verification/v1-acceptance.md.
- 2026-08-12 12:12 T-015 — Final review: 53 findings, 48 refuted, 5 fixed. Worst was TASKS.md writes deleting unmodelled content.
- 2026-08-12 12:00 T-015 — Claude setup ported (.claude/rules + hooks + settings), README and domain glossary written.
- 2026-08-12 11:57 T-014 — Hook installer verified on a real project: hooked session marked done via SessionEnd, which the watcher cannot know.
- 2026-08-12 11:55 — Bounded backfill made old sessions look promptless; added historyTruncated so "partial history" is stated, not implied.
- 2026-08-12 11:52 T-013 — Hook sink live: session went active via hook alone. Forwarder exits 0 in 53ms with server down.
- 2026-08-12 11:50 T-012 — Run button verified end-to-end: real claude run wrote HELLO.md, updated TASKS.md; cancel exits 143, no orphans.
- 2026-08-12 11:48 T-011 — Dispatcher done. Stream rendered readable server-side (src/server/dispatcher/stream.ts), raw json never reaches UI.
- 2026-08-12 11:42 T-010 — TASKS.md watcher live: hand edit appeared in browser with no reload. Snapshot now carries task docs.
- 2026-08-12 11:41 T-007 — M1 review: 30 findings, 24 refuted, 6 fixed (2 security: DNS rebinding + cross-origin WS). See docs/verification/m1-review.md.
- 2026-08-12 11:36 T-009 — Board verified in browser: created T-016 from UI, moved it, landed on disk correctly, then removed.
- 2026-08-12 11:33 T-008 — TASKS.md parser/serializer done; round-trips this repo own backlog. 13 tests.
- 2026-08-12 11:31 T-006 — Session view verified in browser: 406 entries, tool paths, subagent tags, no thinking leaked.
- 2026-08-12 11:30 T-005 — Overview live in browser: this session visible, msg count rises with no reload. WS path is /ws.
- 2026-08-12 11:27 T-004 — Watcher live: 54 sessions, this one active. chokidar 5 has no globs; bounded backfill (7d/1MB) added.
- 2026-08-12 11:23 T-003 — Parser done: 14 line types seen in real data, 3 skip buckets, thinking never surfaced. 11 tests.
- 2026-08-12 11:22 T-002 — Registry + GET/POST /api/projects working; escaped-dir derived, corrupt store tolerated.
- 2026-08-12 11:21 T-001 — Scaffold done: TS strict, Fastify 4517, Vite 4518 proxy, Tailwind, Vitest 6/6, lint clean.
- 2026-08-12 11:20 T-015 — Added: final review + Claude setup port + README, discovered while planning.
- 2026-08-12 11:15 — Build design spec + implementation plan written (docs/superpowers/). Research: hooks beat transcripts for live status.
- 2026-08-12 — Backlog created from SPEC.md milestones (M1 visibility → M2 tasks → M3 dispatch → M4 hooks). Start with T-001.
