# Full-project risk audit — 2026-08-12

Three parallel review passes (server resource usage, side-effect safety, frontend load) over the
whole working tree at b465cd0 + uncommitted changes. Findings verified against real code paths;
server numbers were measured on this machine (`~/.claude` = 3.1 GB, 3530 transcripts, 859 active).

## Safety — can damage the user's setup

### S1 — HIGH: registering `$HOME` as a project lets the installer overwrite global `~/.claude/settings.json`
`src/server/registry.ts:27-28` accepts any directory; `src/server/hooks/installer.ts:128-152` then
writes `<projectPath>/.claude/settings.json`. With `projectPath = $HOME` that *is* the Claude data
dir's settings file — the one path the project's own non-negotiable rule forbids. One click in
`web/src/project/HooksBadge.tsx:31`. Missing guard: reject when `join(projectPath,'.claude') ===
resolveClaudeDir()` or `projectPath === homedir()`.

### S2 — HIGH: unparseable `settings.json` is silently replaced
`installer.ts:139-141`: `catch { parsed = {} }` — user's `permissions`, `env`, `mcpServers`, own
hooks all dropped from the live file; only the backup survives. A concurrently half-written file
parses as garbage too. `installer.test.ts:75-83` asserts the backup exists but not that original
keys survive. Should abort instead of writing.

### S3 — HIGH: unauthenticated local API = arbitrary dispatch for any local process
No auth/CSRF; `origin-guard.ts:29` passes requests with no `Origin`. Any local process can register
any dir (`routes/projects.ts:10`), write `<dir>/TASKS.md` (`routes/tasks.ts:22`), and spawn
`claude -p <attacker prompt>` with `cwd` of its choosing (`routes/dispatch.ts:11` →
`dispatcher/index.ts:52-58`), inheriting the server env. `/api/sessions/:id` and the WS snapshot
also expose all transcript text with no Origin.

### S4 — MED-HIGH: `TASKS.md` rewrite loses content the parser drops
`src/tasks/store.ts:67` rewrites the whole file. Reproduced losses: a second `# ` line anywhere
becomes the title and the original is deleted (`parse.ts:72`); non-`- ` lines in Progress log are
discarded (`parse.ts:96-99`, no extras bucket per `parse.ts:57`); blank runs collapsed and sections
reordered (`serialize.ts:44`). The round-trip test proves fixpoint stability, not preservation.

### S5 — MED: `scripts/statusline.sh` has no timeout around the wrapped user command
`statusline.sh:19` runs the previous statusline via `bash -c "$1"` with no `timeout` and no
fallback output — a hang propagates into every Claude session. Installed command is an absolute
path into this checkout; moving the repo breaks statusline + 5 hooks in every installed project,
and there is no uninstall route. `installer.ts:161-171` also drops a string-shaped existing
statusLine. (`hook-post.sh` itself is clean: `--max-time 1`, backgrounded, `exit 0`.)

### S6 — MED: `POST /api/hooks` / `/api/statusline` create sessions unbounded
Both sinks always 200 and `#state()` auto-creates (`session-store.ts:133-138`). No session-count
cap, no eviction — a POST loop with fresh ids grows memory until OOM; also allows spoofing plan
limits and fake active sessions.

### S7 — LOW/MED: non-atomic writes to files we don't own
`installer.ts:152` (settings.json), `store.ts:67` (TASKS.md, no backup), `registry.ts:60` — plain
`writeFile`, no temp+rename. Dispatch writes TASKS.md at the same moment it launches an agent
instructed to edit the same file (`routes/dispatch.ts:33` + `dispatcher/prompt.ts:15-17`).

### S8 — LOW: SIGTERM-only cancel can wedge a project
`dispatcher/index.ts:104-110` — no SIGKILL escalation; a claude that ignores SIGTERM keeps
`endedAt === null` forever and `:48-49` refuses all future dispatches. `#runs` never pruned.

### Verified clean
Dispatcher argv (no shell interpolation, `dispatcher.test.ts:98`); 127.0.0.1 bind everywhere; no
unlink/rm in product code; only three write targets (`TASKS.md`, target `.claude/settings.json`,
`projects.json`); `.key` files excluded and tested; no innerHTML/eval in web.

## Server load (measured)

### L1 — ~4,272 fs.watch handles, 142 MB RSS for the watcher alone
`watcher/index.ts:36-42` watches the whole `~/.claude/projects` tree, no `depth`. chokidar 5 has no
fsevents — one handle per dir *and* per file. Measured: ready 922 ms, 4270 tracked entries,
142 MB RSS.

### L2 — startup backfill reads 259 MB, 2.1 s CPU, RSS spike 283 MB → ~200 MB steady
859 recent files × min(size, 1 MB) cap (`backfill.ts:8`). ~1.1 MB heap per tracked session. Under
`tsx watch`, every server-file save repeats the whole cycle.

### L3 — AgentsPoller forks the full claude CLI every 30 s
`agents-poller.ts:8,141` — measured 0.24 s CPU and 348 MB peak RSS per poll; 2,880 launches/day.
Emits `change` even when the list is identical (`:157`).

### L4 — installed hook forwarders spawn 2-3 processes per event
`hook-post.sh` (bash+cat+curl per tool call) + `statusline.sh` (bash+curl+bash -c per refresh,
up to ~3/s) ≈ 5-10 short-lived processes/second during an active session — more machine load than
the server itself.

### L5 — truncation/rewrite re-reads the whole file, uncapped
`tail.ts:41-49` — `BACKFILL_MAX_BYTES` applies only on first sight. Largest local transcript is
138 MB → ~300 MB transient + full parse on the event loop.

### L6 — unbounded growth over uptime
`session-store.ts:69` never evicts sessions (~1.1 MB each); dispatcher `#runs` keeps finished
ChildProcess objects; hub has no backpressure (`ws/hub.ts:34-39`) and `dispatch.output` broadcasts
per line to all clients.

### L7 — shutdown orphans `claude -p` children
No `process.on(SIGINT/SIGTERM)` anywhere in `src/server`; `onClose` stops poller/watchers but not
the dispatcher. Cancel signals the pid, not the group. The 30-min timeout timer is not unref'd.

### L8 — double JSON.parse of every rejected line
`transcript/parse.ts:235` → `classifySkip:204` re-parses; `file-history-snapshot` lines (largest in
a transcript) are parsed twice, including during the 259 MB backfill.

### Measured fine
60 s sweep = 1 ms; snapshot = 2 ms / 203 KB; tailing is true byte-offset; TasksWatcher depth 0;
UsageAccumulator incremental.

## Frontend load

### F1 — full-transcript refetch on every `session.updated`
`useSessionDetail.ts:41-43` refetches the whole transcript (up to 4000 entries, no since/limit in
`routes/sessions.ts:19`) up to ~6×/s during an active run; `inFlight` guard drops rather than
coalesces, so it can also go stale.

### F2 — SessionView renders 4000 entries unvirtualized
`SessionView.tsx:129`, `TimelineEntry.tsx:23` — no memo/windowing, fresh identities each refetch,
4000 `toLocaleTimeString` calls per pass + forced layout read (`SessionView.tsx:44-50`). The 30 s
clock tick re-renders all of it even when idle.

### F3 — WS reconnect: fixed 1.5 s forever, no backoff/jitter, whole-app re-render per attempt
`useLiveState.ts:138,51,136`.

### F4 — `runs`/`runOutput` never evicted client-side
`useLiveState.ts:88-95` — 200 KB per run retained for tab lifetime; each output chunk rebuilds the
map and `RunPanel.tsx:24-29` re-renders a 200 K-char `<pre>` with a forced reflow.

### Minor
`TaskBoard.tsx:50` setTimeout not cleaned up; `notifications.ts:70` sync localStorage read on every
socket message before the cheap check. Notifications gating itself is clean and bounded.
