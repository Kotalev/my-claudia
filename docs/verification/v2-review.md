# v2 review — live processes and telemetry

Four parallel dimension finders over `f6b8899~1..HEAD`, each finding then handed
to an independent skeptic instructed to refute it and to default to refuted when
uncertain.

**29 raised · 18 refuted · 11 fixed.**

## Fixed

| # | Severity | What was wrong |
|---|---|---|
| 1 | high | `priceBucket` charged cache writes only from the 5m/1h split, but the parser deliberately supports older lines carrying just the flat total. Those tokens cost **nothing**, and since the no-caching counterfactual used the flat field, the panel showed an imaginary "caching saved $5.00" on a session priced at $0.01. On this repo's own session the understatement was $10.46. |
| 2 | high | Session state grew ~28 MB/day and was never evicted: entries were appended without limit and an ended session was only flagged. Retention is now capped at 4000 entries per session, oldest first, and the session is marked truncated — which the UI already renders as "partial history". |
| 3 | high | Occupancy was sized against `models[last]`, which is whichever model spoke last — including a subagent. A 200k subagent after a 1M main thread made the bar read `300k / 200k`, clamped full and amber. The accumulator now records the model of the main-thread turn the reading came from. |
| 4 | high | Plan limits never expired and carried no age, so an 82% reading from before a window reset kept showing as current. Expired windows now say so, and the bar states when it was measured. |
| 5 | high | `AgentsPoller` kept its last good answer forever, so once `claude agents --json` started failing, finished background agents stayed in the Live band with an animated dot and a growing elapsed time. It now rides out two failures and admits ignorance on the third. |
| 6 | medium | A registry entry with a missing or non-numeric `startedAt` became epoch 0, failed the pid-reuse check, and declared a **running** session dead. It is now null, which skips the check rather than inverting it. |
| 7 | medium | `setLive` compared only `state`, so a change from "waiting for permission" to "waiting for your answer" was never broadcast. It compares the whole process now. |
| 8 | medium | `SessionsRegistry` could not watch a directory that did not exist, so on a fresh config dir the Live band would have said "nothing running" forever. A 15s rescan recovers, and only emits when something actually changed. |
| 9 | medium | `stop()` during the first in-flight poll still armed the 30s interval afterwards, leaving it shelling out to `claude` for the process lifetime. |
| 10 | medium | The Claude-Code-reported dollar figure sat below the subscription disclaimer attached to the *other* number, so it read as an actual charge. It carries its own caveat now. |
| 11 | low | `ps -o lstart=` prints in the current locale; `Date.parse('mer. 12 août …')` is NaN, silently disabling the pid-reuse guard. `LC_ALL=C` is now forced. |

## Notable refutations

Eighteen findings did not survive. The pattern worth recording: several claimed
double-counting in the incremental accumulator that the per-message dedup map
already prevents, and several claimed the origin guard did not cover the new
`/api/statusline` route — it does, because it is a global `onRequest` hook.

## A test that was wrong, not the code

The first version of the flat-cache-pricing test asserted that caching is always
cheaper. It is not: a cache **write** costs 1.25x base input, so a bucket of pure
writes with no reads costs more than not caching at all. The assertion was
corrected rather than the code, and the panel only claims a saving when there is one.
