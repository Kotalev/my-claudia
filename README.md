# Claude Mission Control

A local web dashboard over every Claude Code session on your machine: which
sessions are running, what each one is doing, how much they cost, and a
per-project task backlog you can dispatch work from.

Everything is local. One Node process, bound to `127.0.0.1:4517`, no database,
no account, no telemetry.

## What it does

- **Live session view** — every Claude Code session across your registered
  projects, with a timeline of the conversation, tool calls, token usage,
  context occupancy, and an honest cost estimate per session.
- **Task board** — each project's `TASKS.md` rendered as a board. Add tasks,
  move them between columns, and press **Run** to dispatch one to a headless
  `claude -p` process, tracked live until it finishes.
- **Plan limits** — your plan's rate-limit windows (session, week) with reset
  times, fed by an opt-in statusline forwarder.
- **Spend tracking** — account-wide spend across registered projects, priced
  from transcripts.
- **Desktop notifications** — an opt-in bell that pings you when a session is
  waiting for input.

## Running it

```bash
npm install
npm run dev          # API on :4517, UI on :4518
```

On startup the server prints the dashboard URL, including a one-time auth
token:

```
dashboard: http://127.0.0.1:4517/?token=<hex> (dev UI: http://127.0.0.1:4518/?token=<hex>)
```

Open that URL — the token is required once, then lives in the browser. Register
a project by its absolute path using the **Add project** field on the overview
page. The dashboard then shows that project's sessions, its `TASKS.md` board,
and a **Run** button that dispatches a task to a headless `claude -p`.

## Hooks (recommended)

Open a project and press **Install hooks**. This merges four hooks —
`SessionStart`, `SessionEnd`, `Stop`, `PostToolUse` — into that project's
`.claude/settings.local.json`, backing up the previous file first.

Hooks matter because they are the only *deterministic* signal. Claude Code's
docs state that `transcript_path` is written asynchronously and can lag the
current turn, so file watching alone cannot reliably tell you a session just
started, or that it ended rather than went quiet. With hooks installed, a new
session appears within a second and a finished one is marked `done` instead of
fading to `idle`.

The forwarder (`scripts/hook-post.sh`) backgrounds its request with a 1 second
cap and always exits 0. With the dashboard stopped, a hooked session costs about
50 ms and notices nothing. Breaking your Claude Code sessions would be the worst
possible bug in this project, so the hook is built to fail rather than block.

The statusline forwarder (`scripts/statusline.sh`) works the same way: it
passes the statusline payload — which carries your plan's rate-limit windows —
to the dashboard and hands it on unchanged, so your own statusline keeps
working.

## TASKS.md

The board is a plain markdown file in your project — readable, diffable, and
edited by hand or by an agent just as easily as by the dashboard:

```markdown
## Todo

- [ ] **T-003** Add dark mode toggle `#ui` `#p2`

## In progress

- [~] **T-002** Wire session timeline `#p1`

## Done

- [x] **T-001** Project scaffolding `#p1` (2026-08-12)

## Progress log

- 2026-08-12 14:20 T-002 — parser handles tool_use lines
```

Ids are sequential and never reused. The writer round-trips: parsing, writing
and re-parsing yields an identical structure, so the dashboard cannot quietly
mangle a backlog you maintain by hand.

## Security

The server binds loopback only, and three guards are enforced in code:

- **Auth token.** Loopback keeps remote hosts out, but any local process can
  speak to `127.0.0.1`. Every API and WebSocket request must carry a token,
  generated on first start and stored in a `0600` file (`.auth-token`). It
  reaches the browser once via the startup URL. The hook and statusline sinks
  are deliberately exempt: the forwarder scripts run inside your Claude Code
  sessions and must never carry a secret into files Claude Code owns.
- **Host validation.** Without it, DNS rebinding lets a remote page resolve its
  own hostname to `127.0.0.1` and read every transcript on your machine as
  same-origin.
- **Origin validation on the WebSocket.** WebSockets are exempt from the
  same-origin policy and send no preflight, so any page you happen to have open
  could otherwise connect and stream your prompts to a third party.

Beyond that: the dashboard never writes under the Claude data dir; the sole
exception is the hook installer editing a target project's own
`.claude/settings.local.json`, always after writing a backup. Task text reaches
`claude` as a single argv element, never through a shell.

## When the transcript format changes

It will — the docs say so plainly, and the format is internal to Claude Code.
Every assumption about it lives in **`src/transcript/`** and nowhere else. The
parser handles the line types it knows, counts anything unrecognised as format
drift, and surfaces that count in the UI rather than crashing.

If sessions start looking wrong after a Claude Code upgrade, look for a rising
"unknown lines" count in the session view, then teach `src/transcript/types.ts`
about the new line type. Nothing else should need to change.

## Layout

```
src/server/       API, WebSocket hub, watcher, dispatcher, hook sink, auth
src/server/live/  live sessions registry, agents poller, statusline intake
src/server/usage/ spend ledger and account-level aggregation
src/transcript/   JSONL parsing — the only module that knows the format
src/tasks/        TASKS.md parse / serialize / store
web/              React + Vite + Tailwind frontend
scripts/          hook-post.sh and statusline.sh, the fail-silent forwarders
test/fixtures/    real anonymized transcripts and malformed samples
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + UI with hot reload |
| `npm start` | API only, serving on :4517 |
| `npm test` | Vitest |
| `npm run lint` | eslint + `tsc --noEmit` |
