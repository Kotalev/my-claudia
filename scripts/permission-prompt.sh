#!/usr/bin/env bash
# Asks Mission Control to answer a permission prompt on the user's behalf.
#
# Unlike hook-post.sh this one deliberately BLOCKS: holding the reply open is
# how a dashboard click reaches Claude Code. Every failure mode is safe by
# design — dashboard down, curl missing, timeout — because no stdout means
# Claude Code shows its normal interactive prompt, exactly as before.

payload=$(cat) || exit 0

response=$(curl -s --max-time 25 \
  -X POST http://127.0.0.1:4517/api/hooks/permission \
  -H 'content-type: application/json' \
  --data-binary "$payload" 2>/dev/null) || exit 0

# Only a real decision is worth printing. `{}` or anything unexpected means
# "no opinion", and printing nothing leaves the terminal prompt untouched.
case "$response" in
  *'"hookSpecificOutput"'*) printf '%s' "$response" ;;
esac

exit 0
