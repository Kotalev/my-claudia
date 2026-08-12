# v1 acceptance

**Date:** 2026-08-12
**Claude Code version observed in transcripts:** 2.1.228
**Verified in a real browser via Chrome DevTools MCP.** Screenshots in `.tmp/`.

## Checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Overview shows registered projects with live session status | pass | Both `my-claudia` and `dispatch-demo` render as cards with per-session status dots. `.tmp/v1-overview.png` |
| 2 | The dashboard shows *the session building it*, live | pass | Message count rose 387 → 392 → 1508 with no page reload; the row text tracks the latest turn. This is the SPEC §6 M1 criterion. |
| 3 | Session view tails a live transcript | pass | 406 entries rendered with role colours, tool names and file paths; new entries appended and scrolled to without reload. `.tmp/t006-session.png` |
| 4 | Thinking content never reaches the UI | pass | Searched a full a11y snapshot of the timeline for thinking-only phrases: zero matches. The parser drops `thinking` blocks by construction. |
| 5 | Task board reflects a hand edit to TASKS.md | pass | Added `T-016` by hand in a terminal with the page open; the card appeared without reload. |
| 6 | Dashboard edits land on disk in SPEC §5 format | pass | Created a task from the UI → `- [ ] **T-016** Test task from dashboard \`#p3\``; advanced it → `- [~] …` under `## In progress`. `.tmp/t009-taskboard.png` |
| 7 | TASKS.md round-trips | pass | 144 unit tests including a round-trip over this repo's own backlog. |
| 8 | Dispatch runs a real task end to end | pass | `claude -p` wrote `HELLO.md`, moved T-001 to Done with today's date, and appended two Progress log lines — all in the SPEC §5 format. `.tmp/t012-dispatch.png` |
| 9 | Dispatch output is readable, not raw JSON | pass | Stream renders as `▸ session <id>`, assistant text, `⚙ Read <path>`. Raw stream-json never reaches the client. |
| 10 | Cancel kills the run cleanly | pass | Status `cancelled`, exit code 143 (SIGTERM), `pgrep -f 'claude -p'` empty afterwards. |
| 11 | Hook installer writes correct settings with a backup | pass | Four events installed into the target project's `.claude/settings.json`, each with `timeout: 1`; no backup written because no prior file existed (backup path covered by unit test). |
| 12 | Hooks make a session visible faster than the transcript would | pass | A new hooked session appeared within 2 s (poll granularity) and was marked `done` on `SessionEnd` — a state transcript watching cannot determine at all. |
| 13 | A hooked session is unharmed with the dashboard stopped | pass | Dashboard killed; `claude -p` ran to completion, exit 0, 8.5 s, correct result. Forwarder alone: exit 0 in 53 ms. |
| 14 | Host/Origin guard blocks rebinding and cross-origin sockets | pass | Loopback and the Vite proxy return 200; `Host: evil.tld` returns 403; `Origin: https://evil.tld` returns 403. |
| 15 | `npm test` and `npm run lint` clean | pass | 144 tests across 17 files; eslint and `tsc --noEmit` both silent. |
| 16 | No console errors in the browser | pass | `list_console_messages` returns nothing on Overview, Project and Session views. |

## Known limitations, by design

- **State is in-memory.** A server restart loses hook-derived state, so a session
  that ended while the dashboard was down reappears as `idle`/`active` from its
  transcript alone until the next hook fires. The filesystem is the source of
  truth (SPEC §3); no database in v1.
- **Startup backfill is bounded** to transcripts touched in the last 7 days and
  to the last 1 MB of each. A real tree here is 3.1 GB across 250+ files;
  reading all of it at boot cost minutes of IO for history nobody is viewing.
  Sessions joined mid-file are marked `historyTruncated` and the UI says
  "partial history" rather than implying the earlier turns never existed.
- **One dispatched run per project**, per SPEC §3.3. The Run button hides while a
  run is live rather than offering an action that would 409.
- **Escaped project directories are not reversible**, so sessions in
  unregistered projects are counted but not attributed. Registering the project
  path fixes attribution.

## Deviation from SPEC

The WebSocket is served at `/ws`, not `/api/events` as SPEC §3.5 states. This
keeps the Vite dev proxy config trivially separable from the HTTP API. Recorded
here rather than silently diverging.
