# Claude Mission Control — Build Design (v1, M1–M4)

**Date:** 2026-08-12
**Base:** [SPEC.md](../../../SPEC.md) is authoritative for architecture, API surface, TASKS.md format, security constraints, and milestones. This document records the *refinements and execution decisions* layered on top of it after research. Where this document is silent, SPEC.md governs.

**Scope:** the full v1 — milestones M1 (visibility), M2 (tasks), M3 (dispatch), M4 (hooks); tasks T-001…T-014 in TASKS.md. Built autonomously end-to-end; control is exercised through tests, multi-agent code review after each milestone, and live browser verification.

**Out of scope:** everything SPEC.md lists as non-goals (multi-machine, auth, transcript editing, cost analytics), plus: no Playwright E2E suite (browser verification happens live via Chrome DevTools MCP), no database, no Agent SDK (v2).

---

## 1. Architecture refinements (research-driven)

These sharpen SPEC §3; none contradict it.

### 1.1 Dual-channel status model
- Hook events (M4) are the **primary source for live status**. Official docs confirm `transcript_path` is written asynchronously and may lag the current turn — transcripts cannot be the real-time channel.
- Transcripts are the **source for history/timeline** and the fallback for projects without hooks installed.
- Both channels feed one `SessionStore`, reconciled by `session_id`. The watcher (M1) writes into the same store shape that hook events (M4) later update at higher priority — no restructuring at M4.

### 1.2 Tail mechanics (SessionWatcher)
- chokidar events are treated as a *poke only* (fsevents can fire duplicates and on mere open). On each event: `stat` the file, compare `size` against stored offset; no growth → no work.
- Per-file tail state: `{ byteOffset, partialLineBuffer, lastUuid }`. Read with `createReadStream({ start: offset })`, split on `\n`, keep the trailing partial line (a JSONL line can be mid-write). `JSON.parse` guarded per line.
- If `stat.size < offset` (truncation/compaction): reset offset to 0, reparse, dedupe by line `uuid`.
- Watch `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/**/*.jsonl` with `ignoreInitial: false`, `alwaysStat: true`; **no** `awaitWriteFinish` — own debounce ~150 ms per file.

### 1.3 Defensive parser (src/transcript/)
- Type-allowlist parser: explicit handlers for known line `type`s; every unknown shape increments a visible `skippedUnknown` counter (surfaced in the UI) instead of erroring.
- Track the `version` field seen per file; version drift is displayed, not guessed at.
- The session's real project path comes from the `cwd` field inside lines — never from the (lossy) escaped directory name. The `projects.json` registry remains for grouping/registration per SPEC §3.1.
- `isSidechain: true` lines are subagent activity — parsed and labeled as such in the timeline.

### 1.4 Dispatcher
- Spawn `claude -p <prompt> --cwd <project> --output-format stream-json --verbose`; prompt passed as a single argv element (SPEC §4).
- `session_id` captured from the `system` event with `subtype === "init"` — *scan* for it, don't assume line 1 (startup events may precede it). Persist it immediately so a crashed dispatcher can still link/resume the run.
- Consume stdout eagerly (slow consumers stall claude; drain cap is 30 s on current versions, less on older).
- Cancellation: SIGTERM (aborts the turn, runs SessionEnd hooks, exits 143). Supervisor timeout on top.
- Do **not** pass `--bare` — the target project's CLAUDE.md and hooks must load; pin this behavior explicitly since `--bare` may become the `-p` default.
- Concurrency guard: 1 dispatched run per project (SPEC §3.3).

### 1.5 WebSocket protocol
- On connect: full state snapshot (projects, sessions, tasks). Then incremental typed events (`session.updated`, `task.updated`, `dispatch.output`), each carrying a monotonic sequence number.
- Client detecting a sequence gap requests a fresh snapshot (no replay buffer — state is small and local).
- Ping/pong heartbeat every 30 s; laptop sleep/wake is the main local failure mode.

### 1.6 Dev/prod serving
- Dev: `npm run dev` runs Fastify (127.0.0.1:4517) + Vite dev server with `server.proxy` for `/api` and `/ws` → 4517. Two processes, loose coupling.
- Prod/normal use: Fastify serves `web/dist` via `@fastify/static` — single process on 4517 per SPEC §3.

### 1.7 Hook helper (M4)
- `scripts/hook-post.sh`: fire-and-forget curl, `--max-time 1`, always `exit 0`, silent on failure. Note: `SessionEnd` hooks get only ~1.5 s total budget — the 1 s timeout is deliberate headroom, not paranoia.
- Installer writes minimal hook configs (matcher-free where possible; matcher semantics changed across releases), always backing up the previous `.claude/settings.json`.

## 2. Code structure

Domain-first with path aliases; tests in `__tests__/` mirroring source; facades if a module grows past ~500 lines.

```
src/
  server/        index.ts, routes/, ws/, watcher/, dispatcher/, hooks/ (sink)
  transcript/    parse.ts, types.ts   ← the ONLY module with transcript format assumptions
  tasks/         parse.ts, serialize.ts, types.ts   (TASKS.md round-trip)
  shared/        config.ts (CLAUDE_CONFIG_DIR resolve), types.ts
web/src/
  overview/  project/  session/  shared/     (React + Tailwind + Zustand)
scripts/         hook-post.sh
test/fixtures/   real anonymized transcripts + malformed samples
```

Conventions: TypeScript strict everywhere; PascalCase classes/components, camelCase utils/hooks, kebab-case docs; comments explain *why*, only where the code can't; conventional commits with domain scopes (`feat(watcher): …`); dead code orphaned by a change is removed in that change.

## 3. Quality & control (autonomous mode)

- **TDD** for every parser/writer: fixtures first (real + malformed), then implementation. TASKS.md writer has a parse → serialize → parse round-trip test (CLAUDE.md requirement).
- **Per milestone**: after implementation, a multi-agent code-review Workflow (finders across correctness/security/format-drift dimensions, adversarial verification of findings), fixes applied, then live browser verification via Chrome DevTools MCP with screenshots saved to `.tmp/`.
- **M1 acceptance** (SPEC §6): the dashboard shows *the very session building it*, live.
- **TASKS.md discipline**: statuses and Progress log maintained throughout — it doubles as dogfooding of the format.
- Git: repo initialized at start; commits at task boundaries; no destructive git commands ever.

## 4. Execution model (hybrid — user's choice)

- Tasks T-001…T-014 built **sequentially in the main context** with TDD — maximizes coherence between modules.
- **Workflow orchestration reserved for quality gates**: the per-milestone multi-agent review + adversarial verification described in §3.
- Browser verification uses the project's Chrome DevTools MCP (`.mcp.json`); if the server is not connected in the session, that check pauses until it is — it is not skipped silently.
- Claude Code setup ported from collaboration-tool (base set, adapted): `.claude/rules/` (git-restrictions, unit-tests, autonomous-runs, context-preservation), `.claude/hooks/` (session-context, git-guard, sound cues), CLAUDE.md extended with a domain-terms glossary. No PRP system — TASKS.md plays that role here.

## 5. Risks (beyond SPEC §7)

| Risk | Mitigation |
|---|---|
| Chrome DevTools MCP not connected when browser verification is due | Pause and ask the user to approve/reconnect; never claim visual "done" without it |
| Watching this very machine's `~/.claude` while Claude builds the project (feedback loop: the build session's own transcript grows constantly) | Fine — it's the M1 acceptance test; debounce keeps load trivial |
| Sequential build stalls on an unforeseen blocker | Blocker recorded in TASKS.md Progress log + surfaced to user; adjacent unblocked tasks proceed |
