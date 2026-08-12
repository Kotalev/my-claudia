#!/usr/bin/env bash
# Forwards a Claude Code hook payload to Mission Control.
#
# Non-negotiable: this must never slow down or break a Claude Code session.
# SessionEnd hooks get roughly 1.5s in total, so the 1s cap leaves headroom, and
# the request is backgrounded so even that is not waited on. Every failure path
# — dashboard down, network hiccup, missing curl — still exits 0.

payload=$(cat)

curl -s -o /dev/null --max-time 1 \
  -X POST http://127.0.0.1:4517/api/hooks \
  -H 'content-type: application/json' \
  --data-binary "$payload" >/dev/null 2>&1 &

exit 0
