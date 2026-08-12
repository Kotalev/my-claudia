# M1 review — findings and fixes

**Date:** 2026-08-12
**Method:** four parallel finders (correctness, format-drift, security, resources) over the M1 diff,
each finding then handed to an independent skeptic instructed to refute it.
**Outcome:** 30 findings raised, 24 refuted, 6 confirmed and fixed.

## Confirmed and fixed

| # | Severity | Area | Defect | Fix |
|---|---|---|---|---|
| 1 | high | `tail.ts` | `createReadStream` had no `end`, so it drained past the `stat()` size while the recorded offset stayed at that size. A transcript line appended mid-read was consumed but not accounted for, and reappeared prepended to itself as unparseable JSON — the entry was silently lost. | Bound the read with `end: info.size - 1`. Test: `readNewLines — concurrent appends`. |
| 2 | high | `index.ts` (`/ws`) | WebSockets bypass the same-origin policy and send no preflight, so any page the user had open could connect to `ws://127.0.0.1:4517/ws` and receive the snapshot — every project path, prompt, assistant reply and touched file — plus live updates. | `origin-guard.ts` + a global `onRequest` hook, which also covers the WS upgrade. |
| 3 | high | `routes/sessions.ts` | No `Host` validation, so DNS rebinding gave a remote page same-origin read access to every parsed transcript on the machine. | Same guard: the `Host` header must resolve to a loopback name. |
| 4 | medium | `ws/hub.ts` | One global sequence counter was incremented for unicast messages (connect snapshot, pong), so every *other* client saw a permanent gap and re-snapshotted on each subsequent event. With two tabs open the gap detector fired continuously. | Unicast sends now carry the current sequence without advancing it; the client treats snapshot and pong as a baseline. |
| 5 | medium | `watcher/session-store.ts` | Status is a function of wall-clock time but was only recomputed on file change, so a session that simply went quiet stayed "active" forever in an open tab. | `sweepStatusChanges()` plus a 60 s interval that broadcasts transitions. |
| 6 | medium | `watcher/index.ts` | chokidar's initial scan reported ~250 transcripts at once and each scheduled an independent timer, so all fired together — hundreds of megabytes of buffers and a blocked event loop at boot. | Drains run through a queue capped at 4 concurrent. |

## Found while fixing

`start()` in both watchers returned before chokidar's async initial scan finished, so a file written
immediately afterwards could be missed. This surfaced as a test that passed alone and failed under
load. Both watchers now await the `ready` event — the flake was a real race, not a test artifact.

`TasksWatcher` also watched `<project>/TASKS.md` paths directly; a file that does not exist yet cannot
be watched reliably on macOS. It now watches the project directories and filters, the same lesson as
the earlier chokidar glob removal.

## Refuted highlights

Twenty-four findings did not survive: multibyte-offset claims (the code decodes once after
concatenating buffers), several "unbounded memory" claims already answered by the bounded backfill,
and XSS claims that React's escaping makes inert.
