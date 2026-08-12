# v1 final review — findings and fixes

**Date:** 2026-08-12
**Method:** five parallel finders (correctness, security, format-drift, resources, dead code)
over the whole v1 build, each finding handed to an independent skeptic instructed to refute it.
**Outcome:** 53 findings raised, 48 refuted, 5 confirmed and fixed.

## Confirmed and fixed

### 1. `TASKS.md` writes deleted content the parser did not model — high

`parseTasks` recognised four headings, task lines and progress bullets. Everything
else — prose inside a section, a `### Icebox` subheading, an entire `## Notes`
section — had nowhere to live in `TasksDoc`, and `TaskStore` rewrites the whole
file from that model. A single status toggle in the UI silently deleted the rest
of a user's backlog file.

This also contradicted SPEC §7, which promises "line-based merge on write".

**Fix:** `TasksDoc` gained `sectionExtras` (non-task lines within a known
section) and `extraSections` (whole sections we do not model, kept verbatim).
Fenced code blocks are now tracked, so a `# ` inside one no longer overwrites the
document title. Verified against both real `TASKS.md` files in play: zero lines
lost through a full parse → serialize cycle.

### 2. Session view opened a second WebSocket — high

`useSessionDetail` opened its own socket per session view. That connection
received a full snapshot plus every broadcast in the system just to learn about
one session, and had no reconnect logic, so it died silently on sleep/wake.

**Fix:** one socket for the whole app. `App` passes the session's live
`lastActivity` down, and a change in it is the refetch signal.

### 3. `npm run build` produced a bundle nothing served — high

`@fastify/static` was a dependency that was never imported. `npm start` served
the API alone, so the built frontend was unreachable and production mode did not
exist.

**Fix:** the API serves `web/dist` when it is present, with an SPA fallback that
still 404s under `/api` and `/ws`. Verified: `npm start` alone now serves the
whole dashboard on `:4517`.

### 4. Machine content was displayed as the user's last prompt — low severity, visible everywhere

Deciding what counts as a human prompt (`role === 'user' && !isMeta`) lived in
the session store, outside `src/transcript/` where CLAUDE.md requires all format
assumptions to live. It was also wrong: Claude Code replays slash-command output,
injected reminders and command wrappers as user turns, so
`<local-command-stdout>Set effort level to medium…` became a session's headline
prompt.

**Fix:** the parser now sets `isHumanPrompt`, filtering injected wrappers, meta
lines, subagent traffic and tool-result-only turns. On the committed fixture, 4
user-role lines with text reduce to 2 genuine prompts.

### 5. Hook command was not shell-quoted — low

The installer wrote the absolute script path straight into a project's
`.claude/settings.json`. Hook commands run through a shell, so a checkout under a
path containing a space produced a hook that could never execute — invisibly,
since the forwarder is fail-silent and `isInstalled()` compared the broken string
against itself and reported success.

**Fix:** the path is shell-quoted, with embedded single quotes escaped.

## Refuted highlights

Forty-eight findings did not survive. The largest groups: claims that bounded
backfill leaks memory (it is bounded by design and measured at 66 MB against a
3.1 GB tree), XSS claims that React's escaping makes inert, and Host-guard bypass
theories that the hostname allowlist already rejects.
