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

Installable per project (dashboard offers a "install hooks" helper that merges into `.claude/settings.local.json` — hooks carry absolute paths into this checkout, so they are per-machine and stay out of version control):

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
- Dashboard never writes to `~/.claude` except the opt-in hook install into a project's `.claude/settings.local.json` (with a backup of the previous file). The installer refuses `$HOME` and any path whose `.claude` is the Claude data dir, and aborts on an unparseable settings file instead of replacing it.
- Every `/api` route and `/ws` require a token (random, persisted 0600 in `.auth-token`, handed to the browser once via `?token=`), except the hook/statusline sinks and `/api/health` — loopback binding alone does not keep other local processes out.

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

## 8. Live processes and telemetry (v2)

Added after v1, once the dashboard's purpose settled on "every running process,
with the numbers that decide what to do next".

### 8.1 What a process is

A **process** is one live `claude` execution. Three sources, all keyed by
`sessionId`, so they join without parsing any path:

| Source | Covers | Liveness |
|---|---|---|
| `<claude dir>/sessions/<pid>.json` | interactive and SDK processes | `kill(pid,0)` **and** the pid's real start time within 120s of `startedAt` |
| `claude agents --json`, polled every 30s | background agents — **no pid, no registry file**, invisible to the source above | the CLI's own filtering |
| `RunHandle` | runs this dashboard dispatched | our own child process |

Verified traps, both live in the code as comments:

- The registry's `procStart` string is **UTC**; `ps -o lstart=` prints **local
  time** in the same format. Comparing them as text succeeds only on a UTC
  machine. We never read `procStart` — `ps` is the stable signal.
- Stale registry files outlive their process (one survived a SIGKILL
  indefinitely), so a recycled pid would resurrect a dead session without the
  start-time check.
- `*.key` files sit beside the JSON, mode 600. They are secrets. Only
  `<digits>.json` is ever opened.

**Freshness.** Background agents are listed by the CLI until someone dismisses
them, so a run blocked on the user months ago is still reported. Those are
dropped above seven days — the same window the watcher uses to decide a
transcript is too old to read. Interactive processes are never aged out: their
pid already proves they are alive.

### 8.2 Status precedence

1. **Not live** (no entry, or pid alive but started at the wrong time) → `done`.
   This overrides everything; it is the only signal that can conclude a session
   *finished* rather than merely went quiet.
2. Registry `waiting`, or a background agent `blocked` → **`waiting`**. The agent
   is blocked on the user. Nothing else — not transcript growth, not hooks — can
   distinguish this from idle, and it is the state that most needs a person.
3. Registry `busy`, a hook inside the active window, or transcript growth → `active`.
4. Live but quiet → `idle`.
5. No live entry and never seen live → the v1 time-decay rule.

Claude Code's own status enum, read out of the 2.1.228 binary, is
`busy | shell | idle | waiting`. `waiting` is written exactly when a dialog is
blocking the session: a permission prompt, a sandbox request, an elicitation, a
managed-settings prompt. `shell` is a foreground shell command — the session
working, so it maps to `active`. `idle` is a session sitting at an empty prompt,
which is nobody's problem and must never be mistaken for `waiting`.

`statusUpdatedAt` is written **only on a transition** (`...status !== undefined &&
{ statusUpdatedAt: now }`). It is a record of an event, never a heartbeat: a
`waiting` stamped an hour ago means the prompt has been open an hour, not that
anything is still refreshing it. Nothing falls back to `updatedAt`, which is
rewritten on every touch and would make an old prompt look new.

A source that cannot read is not a source reporting nothing. `readdir` failing
with `ENOENT` genuinely means no sessions; any other error keeps the previous set
and emits nothing, because an empty answer would take every live session through
`done` and back again on recovery — a transition the UI, and now the notifier,
treat as real.

### 8.3 Project resolution without un-escaping

Escaping is lossy, so it is never reversed (`my-claudia` would become
`my/claudia`). In order: the live process's own `cwd`, then the newest
transcript entry's `cwd`, then a registered project, then "path unknown".
Registration no longer gates visibility — only the TASKS.md features.

### 8.4 Usage accounting

- **Dedup by `message.id`, not `uuid`.** Claude Code writes one transcript line
  per content block, each repeating the same usage block. Summing lines inflates
  every total severalfold. Where two lines disagree (6 of ~50k pairs measured),
  the maximum per field wins.
- `usage.iterations` is an **array**, not a count. `cache_creation` is an object
  holding the 5m and 1h buckets, whose sum is `cache_creation_input_tokens` —
  price the buckets, never both.
- `<synthetic>` is not a model and API-error turns are not turns; neither is counted.
- Subagent transcripts (`.../<sessionId>/subagents/agent-*.jsonl`) already fold
  into the parent session, and are ~21% of usage-bearing lines. They are counted
  in totals and cost, but never in occupancy: a subagent has a context window of
  its own.

### 8.5 Context occupancy

`input + cache_read + cache_creation + output` of the last **main-thread**
assistant turn. It lags by one turn — a large tool result is not counted until
the next request — and it falls after a compaction, which is correct, not a bug.

An unrecognised model yields **no bar and a raw token count**. A percentage of an
assumed window is confidently wrong; `claude-fable-5` already ships in real
transcripts and appears in no third-party table. Never use the statusline's
`exceeds_200k_tokens`: it is a fixed 200k check regardless of the real window.

### 8.6 Cost policy

There is no cost field anywhere on disk. Cost is derived in `src/shared/pricing.ts`
from list prices, stamped with `PRICES_VERIFIED_ON`, bucketed per model *and* per
rate modifier (`speed`, `inference_geo`) so a session that switched models is not
priced at one rate. An unknown model costs `null`, never `0`.

Two figures are shown, because the user is on a subscription and asked what
pay-as-you-go would have cost: the estimate **with** the caching that actually
happened, and the same tokens **without** it. Every figure carries `≈` and a
persistent qualifier stating that subscription plans bill differently — Anthropic's
own documentation says the equivalent figures in `/usage` and `total_cost_usd` are
client-side estimates irrelevant to Max and Pro billing. No cross-project
"spent today" total is built: that is the number that ends up in an email to
someone's finance team.

### 8.7 Plan limits

The 5h and 7d windows exist in no file and no public API. The only supported
source is the statusline hook. It is installed **at project scope**, never in the
Claude data dir, and it wraps whatever statusline the user already runs, passing
the payload on and printing that command's output. Verified: 66ms with the
dashboard down, exit 0 even when the passthrough command is broken.

### 8.8 Notifications

Opt-in, one button, no settings panel. A notification fires only on a transition
*into* `waiting`, and only when: the user opted in and the browser granted
permission; the previous status is known (a snapshot seeds the table silently, so
connecting, reconnecting and resnapshotting after a gap are all quiet); the
process is not a background agent (those report no transition time at all, and
the only real ones observed had been abandoned for weeks); the transition is
under five minutes old; the user is not already looking at that session in a
focused tab; and that session has not notified in the last minute.

Notifications are withdrawn when the session leaves `waiting` — on the delta
path, and again from every snapshot, which closes anything whose session is no
longer waiting. The second one is not redundant: if the socket blips while the
user answers the prompt, the transition out of `waiting` never arrives as a
delta, and the snapshot overwrites the status the delta path would compare
against. A Web Notification does not close itself, and a tray still saying
"waiting for you" after the prompt was answered is worse than no notification.

Accepted and not solved: one notification per open tab (softened by tagging on
session id), and a block that begins while the tab is disconnected is never
announced — the price of a silent reconnect.

### 8.9 Why dispatch stays on `claude -p`

The Agent SDK (`@anthropic-ai/claude-agent-sdk`) was evaluated and rejected. It
does not remove the child process, it hides one: the package bundles its own
native `claude` binary (288 MB) and speaks the same `stream-json` this repo
already parses in 155 lines. Billing is *not* the objection — without
`ANTHROPIC_API_KEY` it reads the same subscription credential the CLI does. The
objections are structural: `interrupt()` is unavailable for a string prompt, so
cancellation falls from an immediate SIGTERM over the process tree to a ~2s
graceful abort with no exit code; the bundled binary is a different version from
the CLI whose transcripts `src/transcript/` parses; `sdk-cli` registry entries
carry no status, so every dispatched run would read `idle` forever; and the seam
that proves the argv-not-shell rule of section 4 *is* the spawn. Revisit only for
multi-turn dispatch, in-process hooks, or per-run `canUseTool` approval.

### 8.10 Frontend layout and colour

Decisions the UI must not drift back from. They exist because the dashboard
broke in ways screenshots caught and code review did not.

**One shell.** `web/src/shared/Page.tsx` owns the only padding scale
(`p-4 sm:p-6 lg:p-8`) and the only two measures: `--container-page` (88rem) for
the dashboards, `--container-reading` (64rem) for the transcript. A flat `p-8`
spent a sixth of a 390px viewport on margin, and nothing capped width at all,
so a 1440px window pinned content left and a transcript line ran ~190
characters. No screen sets its own padding or max-width. The dark ground is on
`html, body`, not only on `<main>` — `<main>` is viewport-width, so overflow or
rubber-band scroll exposed the white canvas.

**The `min-w-0` rule.** A grid or flex item defaults to `min-width: auto`, so
`truncate` on a descendant does nothing unless every ancestor up to a
fixed-width box carries `min-w-0`, and a grid track holding user text is
`minmax(0, …)`. This — not padding — was the cause of every horizontal
scrollbar: an untruncated session prompt widened a project card, which widened
its implicit grid track, which pushed the document sideways. On the Project
screen the same defect collapsed the task board to one word per line. A grid
with no `grid-cols-*` class gets an implicit auto track, so the single-column
case needs an explicit `grid-cols-1`.

**Breakpoints follow the container, not the viewport.** The Project split used
to arrive at `lg`, the same breakpoint at which the board went 3-up, so task
columns got *narrower* as the window grew. The split is now `xl`, the board is
`sm:grid-cols-2 xl:grid-cols-3`, and every column holds at least ~300px.

**Two text tokens, by role.** `--color-faint` for captions and caveats,
`--color-muted` for secondary text and for controls at rest that hover to
white. The raw neutral ramp has no caption colour that clears WCAG AA:
`neutral-500` is 4.18:1 on the page ground and 3.96:1 on a card, and every
honesty caveat in this app is a caption. A caveat nobody can read was not
made — that makes contrast a correctness concern here, not a taste one.

**Status is never colour alone.** `waiting` amber and `active` emerald are the
pair a red-green deficiency collapses, so `StatusDot` carries the label as
visible text or as `sr-only`. `done` is an outline rather than a fill: it was
`bg-neutral-700`, 1.9:1 against the page and indistinguishable from the
neutral-800 borders beside it, so it read as an empty slot. Idle and done now
differ by form as well as luminance.

**Screen state lives in the URL.** `/p/<projectId>/s/<sessionId>`, parsed by
`web/src/shared/route.ts`. It was `useState`, so the browser's Back button left
the app and a session could not be linked to. The server already serves
`index.html` for any non-`/api`, non-`/ws` 404, so this needed no server change.

**One focus treatment**, `FOCUS_RING` in `web/src/shared/focus.ts`. Everything
revealed itself on hover only; a keyboard user got the UA hairline against
neutral-950, and `NewTaskForm` explicitly killed even that with `outline-none`.

**Affordances are disabled, never removed.** The dispatch button used to vanish
from every card the moment a run started, silently reflowing the board and
explaining nothing.

**The Session screen is a viewport-height column.** `h-dvh` + `flex-col`, with
the header and the telemetry panel `shrink-0` and only the transcript scrolling
(`min-h-0 flex-1 overflow-y-auto`). Without `min-h-0` a flex child refuses to
shrink below its content and the page grows a second scrollbar instead. Follow
tracks that container's scroll, not the window's. The telemetry panel is a
`<details>` whose default open state is read once from `min-width: 640px` — it
sits in the fixed region, so an always-open panel leaves a 390px viewport about
three lines of transcript.

**The Live band groups by directory.** The key is `projectId ?? projectPath`,
never the label: a registered project has an id, an unregistered one has only a
path, and two directories can share a basename — a worktree beside its checkout
is exactly that. Two processes with no known path are two groups, because
nothing says they share a project. A group heading carries the *registered*
name where there is one, since it opens that project's card and the process's
self-reported name drifts from the registration. Groups sort by their most
urgent member, so a project with something blocked on the user stays first,
exactly as a blocked row did before grouping. With the project name promoted to
the heading, the row leads with the prompt — the only thing that ever
distinguished two sessions in one project.

**Cursors are a base rule, not a utility.** Tailwind v4's preflight sets
`cursor: default` on buttons, and almost every clickable surface here is a
button rather than a link — a live row, a session row, a project name — so
nothing on the page looked clickable. `web/src/index.css` sets `pointer` on
buttons, summaries and checkbox labels, and `not-allowed` on a disabled button,
so a control added later cannot forget it.

**Icons are lucide-react, and always accompany a label** — never replace one.
Decorative glyphs carry `aria-hidden="true"`, so the accessible name stays the
visible text. It is a devDependency alongside react: it is bundled, not
required at runtime by the server.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Transcript JSONL format changes between Claude Code releases (docs warn it will) | Defensive parser isolated in one module; hooks as the stable primary channel (M4); integration test fixtures from real transcripts |
| Escaped project-dir names not reversible | Registry of user-declared project paths; match by re-escaping |
| Hook curl slows/breaks Claude Code | Fail-silent wrapper, 1s timeout, always exit 0 |
| TASKS.md concurrent edits (agent + dashboard) | Line-based merge on write, file watcher re-reads before write, last-writer-wins with conflict log |
