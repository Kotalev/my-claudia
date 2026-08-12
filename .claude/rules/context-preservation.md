# Context preservation

## What belongs where

| Kind of fact | Home |
|---|---|
| What to work on next, task state, progress history | `TASKS.md` |
| Architecture decisions, verified platform facts | `SPEC.md` |
| How to work in this repo | `CLAUDE.md` and `.claude/rules/` |
| Findings from a review pass | `docs/verification/` |
| Durable facts about the user or their preferences | the memory directory |

Nothing durable belongs only in a conversation.

## Before compaction, and before ending a long run

1. Append the current state to the `TASKS.md` Progress log — newest first, one
   line, under ~120 characters.
2. Move any task whose status changed into the right section.
3. If something was learned that outlives the task (a platform fact, a format
   quirk), put it in `SPEC.md` or the relevant rule file, not the log.

## Progress log discipline

The log is append-only and newest-first. One line per meaningful milestone, not
per file edit. Format:

```
- YYYY-MM-DD HH:MM T-NNN — what happened
```

A good line says what changed and what it means. "Fixed watcher" is useless;
"chokidar 5 has no globs; watch the tree and filter" is worth reading in a month.
