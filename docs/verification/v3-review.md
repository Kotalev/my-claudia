# v3 review — notifications and `waiting` correctness

Four parallel dimension finders over the uncommitted working tree, each finding
handed to an independent skeptic instructed to refute it and to default to
refuted when uncertain.

**24 raised · 19 refuted · 5 fixed.**

## Fixed

| # | Severity | What was wrong |
|---|---|---|
| 1 | high | A snapshot never withdrew an open notification. If the socket blipped while the user answered the prompt, the transition out of `waiting` was never delivered as a delta — and the snapshot then overwrote the status the delta path compares against, so the withdrawal was lost permanently, not merely delayed. The tray kept saying "waiting for you" and clicking it opened a session that was not blocked. `reconcile()` now closes every notification whose session is not waiting in the snapshot. |
| 2 | high | `asTimestamp` guarded with `Number.isFinite`, which admits any finite number — including values past Date's ±8.64e15 range, where `toISOString()` throws. A timestamp written in nanoseconds would have thrown out of `parseSessionFile`, whose own contract is to return null rather than throw, and taken down `refresh()` — as an unhandled rejection from the rescan, or as a failure to start the server at all. |
| 3 | medium | Same defect as 1, found from the other direction (the answer landing while the tab is disconnected). Fixed by the same change. |
| 4 | medium | Unregistering a project made its finished sessions disappear entirely: they kept a `projectId` matching no card, and the "N sessions in unregistered projects" line only counts sessions whose `projectId` is null. `forgetUnregistered` now clears the stale record and rebroadcasts. |
| 5 | high | The ENOENT branch of `refresh()` was untested — deleting it left the suite green, because the only test started from an empty live set. The new test seeds a live session first, then removes the directory, so a regression that pinned the last session live forever now fails. |

## Notable refutations

Nineteen findings did not survive. The recurring pattern: several claimed the
notification could fire on a reconnect, which the silent snapshot seeding already
prevents; several re-litigated the status enum as an assumption, when it was read
out of the 2.1.228 binary; and several proposed hardening against inputs that
cannot reach the code path they targeted.
