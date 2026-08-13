# Tasks

## Todo

- [ ] **T-059** Finished sessions show WORKING for ~5 min: registry `idle` must beat freshness in `deriveStatus`; keep the fresh fallback only for status-less (sdk-cli) processes `#p1`

## In progress

## Done

- [x] **T-060** Steering: send follow-up messages to a live dispatched run over stream-json stdin; input box on the run panel `#m14` `#p1` (2026-08-13)
- [x] **T-061** Start/resume sessions from the dashboard: new prompt against a project, resume an existing session headlessly `#m14` `#p1` (2026-08-13)
- [x] **T-062** Remote access: opt-in `MC_HOST` bind (token stays mandatory), responsive mobile layout, PWA manifest `#m14` `#p2` (2026-08-13)
- [x] **T-063** SQLite history: persist runs/spend to `mission-control.db` via `node:sqlite`; history view with charts `#m14` `#p2` (2026-08-13)
- [x] **T-064** Auto-continue on rate limit + scheduled dispatch (run a task at a set time) `#m14` `#p2` (2026-08-13)
- [x] **T-065** Dispatch queue with retry for failed runs + prompt templates on the dispatch form `#m14` `#p2` (2026-08-13)

- [x] **T-053** Context-pressure warning: occupancy amber ≥85% + "compaction soon" flag on Live rows `#m13` `#p2` (2026-08-13)
- [x] **T-054** In-session search: filter the open transcript by text and by tool on the Session screen `#m13` `#p2` (2026-08-13)
- [x] **T-055** Answer permission prompts from the dashboard: PermissionRequest hook holds the decision, timeout falls back to the terminal `#m13` `#p1` (2026-08-13)
- [x] **T-056** Outbound alert webhook: single POST when a session waits > N min or the 5h window nears its limit `#m13` `#p2` (2026-08-13)
- [x] **T-057** npx distribution: build + bin entry, prod server serves the built frontend `#m13` `#p2` (2026-08-13)
- [x] **T-058** Worktree-isolated dispatch with a diff review before merge `#m13` `#p1` (2026-08-13)

- [x] **T-046** Waiting rows show "waiting Xm" from `statusUpdatedAt`, ticking live `#m12` `#p1` (2026-08-12)
- [x] **T-047** Plan band: live "resets in Xh Ym" countdown from the statusline 5h/7d windows `#m12` `#p1` (2026-08-12)
- [x] **T-048** Opt-in audio alert when a session enters `waiting`, alongside the Web Notification `#m12` `#p2` (2026-08-12)
- [x] **T-049** Live rows show current git branch (read from cwd) and recently touched files `#m12` `#p2` (2026-08-12)
- [x] **T-050** Spend: weekly/monthly rollups + 5h-block burn rate with projected limit-hit time `#m12` `#p2` (2026-08-12)
- [x] **T-051** JSON export: `GET /api/export` for sessions summary + spend ledger `#m12` `#p3` (2026-08-12)
- [x] **T-052** In-memory search across parsed session entries, search box on Overview `#m12` `#p2` (2026-08-12)

- [x] **T-045** Implement the Mission Control Screens redesign (claude.ai/design): IBM Plex type, state/motion token layer (orbit·pulse·shimmer·beacon·caret), instrument PLAN+SPEND band, live rows with motion, task board with compact DONE, transcript hierarchy with chapters, activity blocks and collapsed bookkeeping `#m11` `#p1` (2026-08-12)

- [x] **T-039** Spend band: 30-day daily ledger over registered projects' transcripts, today/7d/30d cost in the header band, live via `spend.updated`; account email in the header. Design: docs/superpowers/specs/2026-08-12-spend-tracking-design.md `#m10` `#p1` (2026-08-12)
- [x] **T-044** Live rows show the session's own name (`/rename`) before the prompt; backend already carried it, the UI never rendered it `#m10` `#p3` (2026-08-12)
- [x] **T-040** Installer guard: refuse to write settings when the target is the Claude data dir or `$HOME` (audit S1) `#p1` (2026-08-12)
- [x] **T-041** Installer: abort on an unparseable existing settings file instead of silently replacing it (audit S2) `#p1` (2026-08-12)
- [x] **T-042** Token auth on the API and `/ws`: random token persisted 0600, required everywhere except hook sinks and health, passed to the browser via `?token=` (audit S3) `#p1` (2026-08-12)
- [x] **T-043** Hook installer targets `.claude/settings.local.json` instead of `settings.json` — hooks carry per-machine absolute paths `#p2` (2026-08-12)
- [x] **T-038** Group the Live band by project; rows lead with the prompt, headings open the project card `#m9` `#p2` (2026-08-12)
- [x] **T-037** Transcript in its own scroll container so the header and telemetry stay put; lucide icons across every screen `#m9` `#p2` (2026-08-12)
- [x] **T-036** UI/UX pass over every screen: token layer, one page shell, the min-w-0 chain, URL routing, focus rings, status without colour alone `#m9` `#p1` (2026-08-12)
- [x] **T-032** Notifications on entering `waiting`: opt-in button, snapshot seeds silently, staleness and cooldown guards, withdrawn when answered `#m8` `#p1` (2026-08-12)
- [x] **T-033** Agent SDK dispatch — **won't do**. Researched and rejected; reasons recorded in SPEC.md 8.9 `#m8` `#p2` (2026-08-12)
- [x] **T-035** `waiting` correctness: read `statusUpdatedAt`, map `shell` to busy, and stop treating an unreadable sessions dir as "nothing running" `#m8` `#p1` (2026-08-12)
- [x] **T-034** Unregister a project from the UI: `DELETE /api/projects/:id`, a `projects.updated` broadcast so open tabs follow, remove button on the card `#m8` `#p3` (2026-08-12)
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

- 2026-08-13 11:05 T-060..T-065 — all six done; browser-verified on prod build: steer/finish, resume recalled context, queue drained, schedule fired at 10:41, template CRUD, history persisted; 656 tests
- 2026-08-13 11:00 T-065 — task run button now queues when the project is busy (was disabled); running detection covers parallel runs
- 2026-08-13 10:50 T-064 — rate-limit auto-continue is test-verified only: a real limit cannot be triggered on demand; scheduler itself fired live
- 2026-08-13 10:35 T-061..T-065 — wave 2 landed sequentially; --resume + stream-json stdin probe-verified (same session id, context kept)
- 2026-08-13 10:05 T-060/062/063 — wave 1 landed + wiring applied; 605 tests, lint clean under Node 24; engines >=22.5
- 2026-08-13 09:55 T-060 — verified live: stream-json stdin keeps claude alive across turns; rate_limit_event carries resetsAt

- 2026-08-13 09:48 T-060..T-065 — round 3 queued (steering, resume, remote, sqlite history, auto-continue, queue+templates); CLI facts being verified
- 2026-08-13 06:45 T-053..T-058 — all six done, browser-verified against the prod build (npx path); 554 tests, lint clean
- 2026-08-13 06:42 T-058 — review diff missed the run's own commits (diff HEAD); base commit now recorded and diffed against
- 2026-08-13 06:37 T-058 — full cycle live: worktree run committed, diff shown, dirty-tree merge 409, clean merge --no-ff landed
- 2026-08-13 06:35 T-055 — live: card Allow/Deny reaches the hook's stdout; timeout and server-down fall back to the terminal
- 2026-08-13 06:20 T-053..T-057 — wave 1 + 2 landed via 6 workflow agents; note: bar's amber threshold unified 0.80 → 0.85
- 2026-08-13 06:07 T-059 — diagnosed: Stop hook + statusline bump hookActivity at turn end, so live-idle sessions read `active` for ACTIVE_WINDOW_MS; repro via SessionStore
- 2026-08-13 06:02 T-053..T-058 — round 2 of competitor adoption queued; workflow implementation starting (2 waves)
- 2026-08-12 23:25 T-046..T-052 — all done; browser-verified (waiting timer via stubbed snapshot: a pty probe session never wrote a registry json, so real `waiting` was unreachable from a script)
- 2026-08-12 22:57 T-047 — real statusline payloads carry resets_at as epoch seconds, not ISO; parser now accepts both (tested)
- 2026-08-12 22:50 T-046..T-052 — all seven implemented via 6 workflow agents, 474 tests green; browser verification in progress
- 2026-08-12 22:37 T-046..T-052 — seven competitor-inspired features queued from the 2026-08-12 competitive analysis; starting workflow implementation
- 2026-08-12 17:35 T-045 — Type switched to Archivo + Martian Mono (both SIL OFL, free) after a 6-variant comparison in docs/design/font-variants.html; browser-verified.

- 2026-08-12 16:55 T-045 — Contrast pass: faint #8b9195 (~6:1), dim #7b8187 (~4.9:1); mock's #4c5457 was 2.6:1. Dropped opacity-70 on done rows/column — tokens carry the recede.

- 2026-08-12 16:50 T-045 — Chapters rail joined the reading measure: it lined up on the viewport edge beside a centred column on wide screens.

- 2026-08-12 16:45 T-045 — Done, browser-verified on all 3 screens with live data; 415 tests + lint clean. Motion is CSS-only, off under prefers-reduced-motion.
- 2026-08-12 16:43 T-045 — Session view: chapters rail (isHumanPrompt is the chapter predicate), activity blocks per tool stretch, bookkeeping folded into counted dividers, ↑/↓ chapter jumps, streaming caret on the live tail.
- 2026-08-12 16:35 T-045 — Token layer remaps the stock neutral/accent ramps in @theme, so untouched classes still land on the new palette; semantic tokens (work/alarm/info/danger) for new code.
- 2026-08-12 16:29 T-045 — Started: design imported from claude.ai/design (screens + brief); plan is token layer first, then shared, overview, project, session.

- 2026-08-12 17:30 T-039 — Done: SpendLedger (31d daily buckets, scan+live dedup by messageId, epoch-guarded scan cancel), spend.updated, SPEND band + account email. 407 tests, lint clean, browser-verified.
- 2026-08-12 17:25 T-039 — Review fixes: null window renders n/a not $0.00; unpriced-only spend keeps the band visible.
- 2026-08-12 17:15 T-044 — kind chip (cli/bg) and short session id dropped from Live rows at user request; the session screen keeps the id.
- 2026-08-12 17:05 T-044 — /rename was already in live.name end-to-end; only the row never rendered it. Name now leads the row. 405 tests, browser-verified.
- 2026-08-12 16:55 T-040..T-043 — Done. 405 tests, lint clean; 401/200 verified live via curl, dashboard + session view verified in browser.
- 2026-08-12 16:50 T-043 — Installer now writes settings.local.json; projects installed before this keep hooks in settings.json (incl. this repo).
- 2026-08-12 16:40 T-040..T-042 — Started from the full-project audit (docs/verification/full-project-risk-audit.md), S1-S3.
- 2026-08-12 16:05 T-039 — Design approved and written to docs/superpowers/specs/; implementation starting.
- 2026-08-12 15:15 T-038 — Live band grouped by directory (projectId ?? projectPath, never the label — a worktree shares its checkout's basename).
- 2026-08-12 15:09 T-037 — Cursors as a base rule: v4 preflight makes buttons `cursor: default`, and nearly every surface here is a button.
- 2026-08-12 14:56 T-037 — Transcript scrolls in its own box (h-dvh flex column, min-h-0). Telemetry collapsible, closed below sm or it leaves 3 lines.
- 2026-08-12 14:55 T-037 — lucide-react added as a devDependency; icons accompany labels, never replace them. Bundle +2.5kB gzip.
- 2026-08-12 14:47 T-036 — Done. lint clean, 358 tests, verified at 390/1440 on all three screens; every honesty caveat still in the tree.
- 2026-08-12 14:45 T-036 — Decisions recorded in SPEC 8.10: one shell, the min-w-0 rule, faint/muted by role, status never colour alone.
- 2026-08-12 14:20 T-036 — Cause of every horizontal scrollbar was min-width:auto on flex/grid items, not padding — truncate needs min-w-0 on every ancestor.
- 2026-08-12 14:10 T-036 — Audit workflow: 6 lenses, 114 agents, 50 findings survived adversarial verification.
- 2026-08-12 13:58 T-036 — Started. Screenshots: overview pinned left at 1440, project board collapsed to one word per line, mobile scrolls sideways.
- 2026-08-12 14:40 — Reconnect verified in browser: answered while the tab was offline, snapshot withdrew the notification. Console clean.
- 2026-08-12 14:30 — v3 review: 24 findings, 19 refuted, 5 fixed. Worst: a snapshot never withdrew a notification, losing it permanently.
- 2026-08-12 14:20 T-032 — Verified in browser against a fake registry: one notification on busy->waiting, withdrawn on the way back, silence for a 10-minute-old prompt.
- 2026-08-12 14:10 T-033 — Agent SDK rejected: it bundles a 288MB claude binary and speaks the same stream-json; cancellation gets worse.
- 2026-08-12 14:05 T-035 — Status enum read out of the 2.1.228 binary: busy|shell|idle|waiting, and statusUpdatedAt is written only on a transition.
- 2026-08-12 13:45 T-034 — Projects can be unregistered; add/remove now broadcast, they only ever reached a tab via the snapshot.
- 2026-08-12 14:00 — Background agents blocked for over 7 days are no longer shown; they are litter, not live processes.
- 2026-08-12 13:50 — v2 review: 29 findings, 18 refuted, 11 fixed. Worst: cache writes priced at zero on the older usage shape.
- 2026-08-12 13:48 — Retention capped at 4000 entries/session; state was growing ~28 MB/day with no eviction.
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
