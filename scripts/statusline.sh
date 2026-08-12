#!/usr/bin/env bash
# Mission Control statusline forwarder.
#
# Claude Code pipes a JSON payload to the configured statusLine command on every
# refresh. It is the only supported source for plan-limit consumption (the 5h and
# 7d windows), which exists nowhere on disk.
#
# Two non-negotiables, both because this runs in every turn of every session:
#   1. Never slow the session down — the POST is capped at 1s and backgrounded.
#   2. Never take away the user's statusline — the payload is handed on to
#      whatever command they had before, given as $1, and its output is ours.
payload=$(cat)

printf '%s' "$payload" | curl -s -o /dev/null --max-time 1 -X POST \
  http://127.0.0.1:4517/api/statusline \
  -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 &

if [ -n "$1" ]; then
  printf '%s' "$payload" | bash -c "$1" 2>/dev/null
fi
exit 0
