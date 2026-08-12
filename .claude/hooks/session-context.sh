#!/usr/bin/env bash
# SessionStart: puts the working state in front of the session immediately, so
# it does not have to spend tool calls discovering where things stand.
#
# Fail-silent by construction: any failure yields empty context rather than a
# broken session start.

set -uo pipefail
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
dirty=$(git status --porcelain 2>/dev/null | head -20)
commits=$(git log --oneline -5 2>/dev/null)
todo=$(sed -n '/^## Todo/,/^## In progress/p' TASKS.md 2>/dev/null | grep '^- \[' | head -3)

context="Branch: ${branch}

Recent commits:
${commits:-none}

Uncommitted:
${dirty:-clean}

Next up in TASKS.md:
${todo:-nothing queued}"

python3 - "$context" <<'PY' 2>/dev/null || exit 0
import json, sys
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": sys.argv[1],
}}))
PY
exit 0
