# Mission Control — UI Redesign Brief

Input package for a full visual redesign. Current screenshots live next to this
file in `screens/`. The app is a **local web dashboard that monitors live Claude
Code sessions across projects** — a "mission control" the owner glances at to
know, within a second, what is running, what is stuck waiting for them, and
what it all costs.

- Stack: React 19 + Tailwind CSS v4 (token layer in `web/src/index.css`), lucide-react icons.
- Dark UI only today (near-black background, gray text, green/blue accents).
- Data is pushed live over one WebSocket; every number on screen updates in real time.
- Three screens, routed by URL: **Overview** (`/`), **Project** (`/p/:id`), **Session** (`/p/:id/s/:id`).

## Design direction (what the redesign must achieve)

1. **High-tech, glanceable mission control.** One look at the Overview must answer:
   is anything working right now, is anything waiting on me, how hot is my plan
   usage. Hierarchy by state, not by layout position alone.
2. **Motion encodes state.** This is the core request:
   - **working / busy / running** → the element visibly *moves*: spinner, orbiting
     dot, animated progress shimmer, flowing gradient border. Continuous, calm motion.
   - **waiting (blocked on the human)** → the element *pulses / alarms*: attention-
     grabbing pulse, glow, or beacon. Waiting is the single most important state in
     the whole app — the user must notice it from across the room.
   - **idle / done** → static, dimmed, recedes.
   - Respect `prefers-reduced-motion` with non-animated equivalents.
3. **Inner pages match the system.** Project and Session views share the same
   visual language as the Overview, each with clearly defined focal points
   (defined per screen below) instead of uniform gray lists.
4. **The session transcript pane gets a real UX pass** (details in the Session
   view section) — today it is a flat monotone list.

Constraints: keep the information; nothing may be dropped, only re-presented.
All states are already delivered live over the socket — animations can rely on
accurate, push-updated state.

## State vocabulary (already in the code, `src/shared/types.ts`)

| Domain | States |
|---|---|
| Session | `waiting` · `active` (working) · `idle` · `done` |
| Live process | `busy` · `waiting` · `idle` · `blocked` |
| Dispatched run | `running` · `succeeded` · `failed` · `cancelled` |
| Socket | `live` · `reconnecting` |

`waiting`/`blocked` are the alarm states. `busy`/`active`/`running` are the motion states.

---

## Screen 1 — Overview (`screens/01-overview.png`)

Component files: `web/src/overview/*` (`Overview.tsx`, `PlanLimits.tsx`,
`SpendBar.tsx`, `LiveBand.tsx`, `ProjectCard.tsx`, `SessionRow.tsx`,
`NotifyButton.tsx`, `AddProject.tsx`), shell in `web/src/shared/Page.tsx`.

Current top-to-bottom structure:

1. **Header** — "Mission Control" title, socket status chip (`live` /
   `reconnecting…` amber), account email, "notify me when a session waits"
   button, "add project" button (expands an inline path form).
2. **PLAN band** — two tiny progress bars: 5-hour window % and 7-day window %
   of the Claude subscription limits, plus "measured Xm ago" staleness note.
3. **SPEND band** — today / 7d / 30d dollar estimates (tooltip: list-price
   estimate, not a bill).
4. **LIVE band** — the heart of the screen. Grouped by project; one row per
   live Claude Code process: status word, session name, last prompt, elapsed
   time, context-occupancy bar (`117k / 1.0M`), model + effort chips.
5. **Project cards** — one card per registered project: name, `N active · M
   total`, remove button, then ~6 recent session rows (status dot, prompt,
   status · age · msg count · badges like `subagents`, `partial history`).
6. **Unregistered sessions disclosure** — collapsed count of sessions in
   unknown projects.

Redesign notes for this screen:

- The LIVE band deserves the visual mass of a command-center: working rows
  animated, waiting rows pulsing above everything else (sort is already
  waiting → busy → idle).
- PLAN + SPEND are the "gauges" — good candidates for instrument-panel
  treatment (radial/segmented gauges, threshold colors as usage approaches
  100%).
- Status dots (`web/src/shared/StatusDot.tsx`) are currently 8px static dots —
  color alone, tiny. Replace with the motion/pulse system.
- Context bar (`web/src/shared/ContextBar.tsx`) is a 96px hairline — barely
  readable. It matters: a session at 90% context is about to compact.

## Screen 2 — Project view (`screens/02-project.png`)

Component files: `web/src/project/*` (`ProjectView.tsx`, `TaskBoard.tsx`,
`NewTaskForm.tsx`, `RunPanel.tsx`, `HooksBadge.tsx`).

Current structure:

1. Breadcrumb back to Overview; project name + absolute path.
2. **Hooks badge** — "hooks not installed" + Install button (writes the target
   project's `.claude/settings.local.json`, backed up first).
3. **New task form** — text input with inline `#tags`.
4. **Task board** — three columns TODO / IN PROGRESS / DONE from the project's
   `TASKS.md`: task id (`T-039`), title, tag chips, date, a move-status button.
   Each task can be dispatched as a headless `claude -p` run ("Run with
   Claude"); a **RunPanel** then streams the run's output with status
   running/succeeded/failed, cost and turn count.
5. **Sessions sidebar** — same session rows as the Overview cards.

Redesign notes:

- Focal points should be: (a) anything live in this project (sessions working /
  waiting, runs streaming), (b) the IN PROGRESS column, (c) the top of TODO.
  DONE is archive — today it visually dominates because it is the only filled
  column.
- A streaming RunPanel is a "working" element → motion treatment.
- The board columns are bare text headings today; the screen has no visual
  relationship to the Overview besides the background color.

## Screen 3 — Session view (`screens/03-session.png`)

Component files: `web/src/session/*` (`SessionView.tsx`, `TelemetryPanel.tsx`,
`TimelineEntry.tsx`), data hook `useSessionDetail.ts`.

Current structure:

1. Sticky header: back breadcrumb, status dot + session id, `just now · 557
   msgs · cc 2.1.228`, **Follow** checkbox (auto-scroll tail).
2. **Telemetry panel** (collapsible "CONTEXT AND COST"): context occupancy bar
   with model + effort, PAYG cost estimate with cache-saving counterfactual
   and long qualifier text, token table (main thread / subagents / total ×
   input / output / cache read / cache write / msgs).
3. **Transcript timeline** — its own scroll container. One entry per parsed
   transcript line: role icon + role word + timestamp, then either message
   text, a tool call line (`Edit /path/to/file`), or "no visible content".
   Compaction boundaries, model changes and API errors are surfaced inline.

Redesign notes — this pane is explicitly called out for a better UX:

- Today every entry has identical size and color; a 4000-message session is a
  wall of `no visible content` rows. Needs hierarchy: real assistant/user text
  large and readable, tool calls compact/collapsible, bookkeeping (`no visible
  content`) collapsed into grouped micro-rows or hidden behind a toggle.
- Tool calls could group into one collapsible activity block per assistant
  turn ("Edit ×3, Bash ×2") instead of six full-height rows.
- A live session's tail is a "working" zone → typing/streaming motion at the
  bottom while `working`; a pulse when the session flips to `waiting`.
- Wanted affordances: jump-to-latest, jump between user prompts (the natural
  chapter marks), visible compaction boundaries as chapter dividers.
- The telemetry qualifier prose is three lines of legalese — keep the honesty,
  move it into a tooltip/details treatment.

## Shared components to restyle once, used everywhere

| Component | File | Today |
|---|---|---|
| Status dot | `web/src/shared/StatusDot.tsx` | 8px colored circle, color-only |
| Context bar | `web/src/shared/ContextBar.tsx` | 96×4px hairline meter |
| Session row | `web/src/overview/SessionRow.tsx` | dot + two lines of gray text |
| Page shell | `web/src/shared/Page.tsx` | max-width column, no chrome |
| Error line | `web/src/shared/ErrorLine.tsx` | plain red text |
| Token/design layer | `web/src/index.css` | Tailwind v4 `@theme` tokens |

## Also present but not screenshotted

- **Add-project form** (header button expands an inline panel with a path
  input; visible in `01-overview.png` if re-captured expanded).
- **Notify button** states: default / enabled / denied-by-browser.
- **RunPanel** while a dispatched run streams (needs a live run to capture).
- **Reconnecting** socket state: amber `reconnecting…` chip in the header.
- Empty states: project with no sessions, empty task board columns ("Nothing
  here"), LIVE band with "nothing running".
