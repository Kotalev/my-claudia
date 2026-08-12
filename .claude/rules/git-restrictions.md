# Git restrictions

## Why this exists

Work in this repo happens across multiple Claude Code sessions, sometimes
concurrently, and the dashboard itself watches the working tree. A destructive
git command does not just lose your own work — it can silently discard another
session's staged changes with no way back.

## Allowed without asking

| Command | Purpose |
|---|---|
| `git status`, `git diff`, `git diff --staged` | See what changed |
| `git log`, `git show` | Read history |
| `git add <specific paths>` | Stage your own files, named explicitly |
| `git commit` | Only when the user asked for a commit |
| `git branch`, `git switch -c <new>` | Create a branch |

## Forbidden — zero exceptions, no matter how convenient

`git stash` · `git reset --hard` · `git checkout .` · `git restore` ·
`git clean` · `git branch -d`/`-D` · `git push` · `git add .` / `git add -A`
when other sessions may be running · any force flag.

If one of these looks like the right answer, stop and ask. The user says yes far
more often than they can recover a lost tree.

## Committing

- Never commit unprompted. Make the change, run the tests, stop.
- Check `git status` before staging: another session may have staged files.
- Stage the specific paths you touched, never a wildcard.
- If on `main` and the work is substantial, branch first.
