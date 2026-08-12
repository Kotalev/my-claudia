# Claude Mission Control — Specification

A local web dashboard that gives you a single view over all your Claude Code sessions across projects: which session is working on what, how far it has gotten, and a way to queue new tasks per project — with progress tracked in a `TASKS.md` file inside each project.

**Status:** v0.1 draft — written 2026-08-12, facts verified against official Claude Code docs on that date.

---

## 1. Problem & Goals

When running multiple Claude Code sessions across several projects, there is no single place to see:

- which sessions exist / are active, per project
- what each session is currently doing and what it last touched
- the status of the project's task backlog
- a way to add a new task and (optionally) immediately dispatch an agent to work on it

**Goals (v1):**

1. Read-only live dashboard of Claude Code sessions per project.
2. Per-project task board backed by a plain `TASKS.md` file in the project repo.
3. "New task" action: appends to `TASKS.md`, optionally launches a headless Claude Code run for it.
4. Deterministic progress tracking via Claude Code hooks (not reliant on the model remembering to update files).

**Non-goals (v1):** multi-machine support, auth/multi-user, editing session transcripts, replacing Claude Code's own UI, cost/usage analytics (v2 candidate).

---

## 2. Verified platform facts (basis for the design)

These were checked against the official docs (code.claude.com/docs) on 2026-08-12:

- **Transcripts:** each session is a JSONL file at `~/.claude/projects/<escaped-project-path>/<session-uuid>.jsonl`. Escaping: every non-alphanumeric character in the project path becomes `-`. Each line is a JSON object (message / tool use / metadata). ⚠️ **The docs explicitly warn the entry format is internal and can change between releases.** Design consequence: the transcript parser must be defensive (unknown-line-tolerant) and isolated in one module.
- **Background sessions:** `claude agents --json` lists background sessions — use it as a supplementary "is anything running" signal.
- **Headless mode:** `claude -p "<prompt>" --output-format stream-json` (formats: `text` | `json` | `stream-json`). `--cwd <path>` sets the working directory. `--resume <session-id>` resumes a specific session; `--continue` resumes the most recent.
- **Hooks:** events include `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`. Configured in `~/.claude/settings.json` (global) or `.claude/settings.json` (per project). A `type: "command"` hook runs a shell command and receives JSON on stdin including `session_id`, `transcript_path`, `cwd`, `hook_event_name`. Exit code 0 = proceed.
- **Agent SDK (optional, v2):** `@anthropic-ai/claude-agent-sdk`, `query()` returns an AsyncGenerator of streamed messages — an alternative to shelling out to `claude -p`.
- **No official local API** for enumerating sessions. Filesystem watching of `~/.claude/projects/` is the sanctioned-in-practice approach; hooks are the stable event channel.
- Respect `CLAUDE_CONFIG_DIR` if set (storage may not be at `~/.claude`).

---

## 3. Architecture

Single Node process serving both API and frontend. Local only — binds to `127.0.0.1`.

```
┌────────────────────────────────────────────────────────┐
│  mission-control (Node + TypeScript, single process)   │
│                                                        │
│  ┌──────────────┐   ┌───────────────┐   ┌───────────┐  │
│  │ SessionWatch │   │  TaskStore    │   │ Dispatcher│  │
│  │ chokidar on  │   │  TASKS.md     │   │ spawns    │  │
│  │ ~/.claude/   │   │  read/write   │   │ claude -p │  │
│  │ projects/**  │   │  per project  │   │ --cwd ... │  │
│  └──────┬───────┘   └──────┬────────┘   └─────┬─────┘  │
│         └──────────────┬───┴──────────────────┘        │
│                 ┌──────┴───────┐                       │
│                 │ Fastify API  │←── POST /api/hooks ←── Claude Code hooks
│                 │ + WebSocket  │                       │
│                 └──────┬───────┘                       │
│                        │ serves                        │
│                 ┌──────┴───────┐                       │
│                 │ React (Vite) │                       │
│                 │  dashboard   │                       │
│                 └──────────────┘                       │
└────────────────────────────────────────────────────────┘
```

**Stack:** Node 20+, TypeScript, Fastify (HTTP + WebSocket), chokidar (file watching), React + Vite + Tailwind (frontend), Vitest (tests). No database in v1 — the filesystem is the source of truth; in-memory index rebuilt on start.

### 3.1 SessionWatcher

- Discovers project dirs under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/`, maps escaped names back to real paths (best effort: keep a `projects.json` registry of known project paths configured by the user; match by escaping the registered path, since escaping is lossy and not reliably reversible).
- Watches `*.jsonl` files; on change, incrementally parses only appended lines (track byte offset per file).
- **Defensive parser** (`src/transcript/parse.ts`): extracts what it can — timestamps, role, text snippets, tool names, file paths touched — and drops unknown line shapes without crashing. All format assumptions live in this one module.
- Derives per-session summary: last activity time, status (`active` if modified < N min ago, else `idle`/`done`), last user prompt, last assistant text, files touched, tool-call counts.
- Supplementary: poll `claude agents --json` every 30s for background-session status.

### 3.2 TaskStore

- Reads/writes `TASKS.md` in each registered project root (format in §5).
- Parses to structured tasks; writes back preserving formatting where practical (line-based edits, not full regenerate).
- Watches the file so edits made by Claude Code sessions (or by hand) appear live in the UI.

### 3.3 Dispatcher

- "Run task" action spawns: `claude -p "<generated prompt referencing the task ID>" --cwd <projectPath> --output-format stream-json`, streams stdout to capture the session ID, keeps a handle for live status, and forwards the stream to the UI over WebSocket.
- Generated prompt template: *"Work on task `<id>` from TASKS.md. When done, update its status and Progress log line in TASKS.md."* (CLAUDE.md in the target project reinforces this — see companion CLAUDE.md.)
- Concurrency guard: max 1 dispatched run per project by default (configurable).

### 3.4 Hook ingestion (the deterministic channel)

Installable per project (dashboard offers a "install hooks" helper that merges into `.claude/settings.json`):

- `SessionStart`, `Stop`, `SessionEnd`, `PostToolUse` → `curl -s -X POST http://127.0.0.1:4517/api/hooks --data-binary @-` (hook stdin JSON forwarded verbatim; a tiny wrapper script `scripts/hook-post.sh` adds the event name and never blocks: always exits 0, 1s timeout, silent on failure so Claude Code is never slowed or broken when the dashboard is down).
- This gives the dashboard push events with `session_id`, `cwd`, `transcript_path` — no polling race, stable across Claude Code releases (hooks are a documented public interface, unlike the transcript format).
- Transcript watching remains as fallback for sessions in projects without hooks installed.

### 3.5 API (all under `http://127.0.0.1:4517`)

- `GET /api/projects` — registered projects + session/task counts
- `POST /api/projects` — register a project path
- `GET /api/projects/:id/sessions` — session summaries
- `GET /api/sessions/:sessionId` — parsed timeline of one session
- `GET /api/projects/:id/tasks` / `POST .../tasks` / `PATCH .../tasks/:taskId` — task CRUD onto TASKS.md
- `POST /api/projects/:id/tasks/:taskId/dispatch` — launch headless run
- `POST /api/hooks` — hook event sink
- `WS /api/events` — pushes `session.updated`, `task.updated`, `dispatch.output` events

### 3.6 Frontend (three screens)

1. **Overview:** project cards — active sessions (green pulse), last activity, task counts by status.
2. **Project view:** left = task board (todo / in progress / done, from TASKS.md), right = session list. "New task" and "Run with Claude" buttons.
3. **Session view:** timeline of the parsed transcript (prompts, assistant summaries, tool calls, files touched), auto-following tail for live sessions.

---

## 4. Security constraints

- Bind `127.0.0.1` only; refuse other hosts. No auth in v1 *because* of this — revisit if that ever changes.
- Dispatcher only runs `claude` with controlled flags; task text is passed as a single argv element (no shell interpolation).
- Hook helper script must be non-blocking and fail-silent (never break Claude Code when dashboard is down).
- Dashboard never writes to `~/.claude` except the opt-in hook install into a project's `.claude/settings.json` (with a backup of the previous file).

---

## 5. TASKS.md format (per project)

Human-readable, git-friendly, trivially parseable. CLAUDE.md instructs agents to maintain it; hooks make the dashboard resilient when they forget.

```markdown
# Tasks

## Todo

- [ ] **T-003** Add dark mode toggle `#ui` `#p2`

## In progress

- [~] **T-002** Wire session timeline to WebSocket `#p1` (session: 8f3a…)

## Done

- [x] **T-001** Project scaffolding `#p1` (2026-08-12)

## Progress log

- 2026-08-12 14:20 T-002 — parser handles tool_use lines, UI next (session 8f3a…)
```

Rules: IDs are `T-NNN`, sequential, never reused. Checkbox states: `[ ]` todo, `[~]` in progress, `[x]` done. Tags inline as `` `#tag` ``. The Progress log is append-only, newest first; one line per meaningful update.

---

## 6. Milestones

- **M1 — Read-only visibility (build this first):** project registry, SessionWatcher, defensive parser, Overview + Session views. *Success: open dashboard, see this very Claude Code session appear live.*
- **M2 — Tasks:** TASKS.md parser/writer, task board UI, new-task form.
- **M3 — Dispatch:** headless runs from the UI with streamed output.
- **M4 — Hooks:** hook installer + `/api/hooks` sink; hook events become the primary status source.
- **v2 ideas:** Agent SDK integration, cost/usage stats, notifications, multi-machine.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Transcript JSONL format changes between Claude Code releases (docs warn it will) | Defensive parser isolated in one module; hooks as the stable primary channel (M4); integration test fixtures from real transcripts |
| Escaped project-dir names not reversible | Registry of user-declared project paths; match by re-escaping |
| Hook curl slows/breaks Claude Code | Fail-silent wrapper, 1s timeout, always exit 0 |
| TASKS.md concurrent edits (agent + dashboard) | Line-based merge on write, file watcher re-reads before write, last-writer-wins with conflict log |
