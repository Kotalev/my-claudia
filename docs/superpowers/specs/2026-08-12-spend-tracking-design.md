# Spend tracking (today / 7d / 30d) + account email — design

Approved 2026-08-12. Task: T-039.

## Problem

The dashboard prices a single session (`TelemetryPanel` via `estimateCost`) but has
no view of what the account spent over time. Per-session accumulators cannot answer
that: backfill is bounded (old or huge transcripts are joined near their end) and
sessions from weeks ago never enter the store at all. The header should also show
which Claude account is logged in.

Scope decisions (user-confirmed):

- **Registered projects only** — not the whole `~/.claude/projects` tree.
- **Windows: today / 7d / 30d**, all rolling over local calendar days.
- **Real estimate only** — the with-caching PAYG figure; no without-cache counterfactual.
- Live updates over the existing WebSocket hub, like the PLAN band.

## 1. `src/server/usage/spend-ledger.ts`

Class `SpendLedger`, per registered project:

- Daily buckets keyed `localDate × rateKey(model, speed, inferenceGeo)`, each a
  `TokenTotals` (reuse `emptyTotals`/`addInto` semantics from `watcher/usage.ts`).
- Dedup map `messageId → {day, rateKey, usage}` merged with `maxUsage` — same
  semantics as `UsageAccumulator`. Only entries whose timestamp is within the last
  31 days are recorded; buckets and dedup entries older than 31 days are pruned.
- **Initial scan** at startup and when a project is registered: walk every
  `*.jsonl` in the project's escaped dir under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/`.
  Files with mtime older than 31 days are skipped entirely; the rest are read line
  by line through the existing transcript parser, keeping only
  timestamp/model/usage/messageId of countable entries (`isCountable`).
- **Live feed**: session-store passes each countable entry to the ledger at the
  point it feeds its own `UsageAccumulator` (`session-store.ts` entry-apply path).
  Dedup makes the overlap between scan and live stream idempotent.
- Unregistering a project drops its buckets.

## 2. Server → client

- `SpendSummary { todayUsd, sevenDayUsd, thirtyDayUsd: number | null, unpricedModels: string[], updatedAt: string }`
  computed from the buckets with the existing `estimateCost()`. Today = local
  calendar day; 7d/30d = today plus the previous 6/29 days.
- Included in the hub snapshot; broadcast as `spend.updated` (analogue of
  `plan.updated`), throttled to at most one broadcast per ~2s while entries arrive.
- **Account email**: read `oauthAccount.emailAddress` from `~/.claude.json`
  (or `$CLAUDE_CONFIG_DIR/.claude.json` when set). Read-only, never written.
  Snapshot field `account: { email: string } | null`; re-read lazily every few
  minutes. Missing file or field → `null`, never a crash.

## 3. UI

- In the band under the header, next to PLAN: segment
  `SPEND  today $4.20 · 7d $31 · 30d $118` (UI language stays English), with a
  title/tooltip "list prices, verified <PRICES_VERIFIED_ON>; estimate, not a bill".
  Unpriced models present → append "+ unpriced". No data yet → the segment hidden,
  like PLAN with no limits.
- Email in the top header next to "live", muted text.

## 4. Testing

Vitest, per the unit-tests rule (happy / malformed / boundary):

- Ledger: dedup across scan + live overlap, day bucketing, pruning at 31 days,
  malformed lines skipped without crash, empty input → zeros not NaN.
- Windows: entries on the boundary days land in the right window sums.
- Account reader: missing file / missing `oauthAccount` → `null`.

## Out of scope

Per-project spend breakdown, without-cache counterfactual in the band, calendar
month window, scanning unregistered projects.
