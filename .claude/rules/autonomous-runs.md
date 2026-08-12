# Autonomous runs

Applies when working through `TASKS.md` without a human watching each step.

## Do not end on an intention

"Next I would add the tests" is not a result. Either add them, or say plainly
that you stopped and why. A run that ends mid-thought leaves the next session
guessing what was actually done.

## Ground every progress claim

Before writing "done" in the Progress log or telling the user something works:
run the command, read the output, and quote it. `npm test` output, a curl
response, a browser snapshot. Evidence, then the claim — never the other way
round.

If verification is impossible right now, say so explicitly: "implemented, not
verified because X".

## Context exhaustion is not a reason to stop

If the work is bigger than one context, finish a coherent piece, record its
state in `TASKS.md`, and say what remains. Never abandon a half-edited file.

## Ask only what blocks you

Prefer a stated assumption over a blocking question. Ask when proceeding under
either interpretation would waste real work or do something irreversible.
