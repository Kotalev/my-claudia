#!/usr/bin/env bash
# PreToolUse(Bash): blocks destructive git commands outright.
#
# Exit 2 tells Claude Code to refuse the tool call and show stderr to the model.
# See .claude/rules/git-restrictions.md for why these specific commands.

set -uo pipefail

command=$(python3 -c "
import json,sys
try:
    print(json.load(sys.stdin).get('tool_input',{}).get('command',''))
except Exception:
    print('')
" 2>/dev/null) || exit 0

case "$command" in
  *"git stash"*|\
  *"git reset --hard"*|\
  *"git checkout ."*|\
  *"git restore"*|\
  *"git clean"*|\
  *"git push"*|\
  *"git branch -d"*|\
  *"git branch -D"*|\
  *"--force"*"git"*|\
  *"git"*"--force"*)
    echo "Blocked by .claude/hooks/git-guard.sh: destructive git commands are forbidden in this repo (see .claude/rules/git-restrictions.md). Ask the user if you believe this is genuinely needed." >&2
    exit 2
    ;;
esac

exit 0
