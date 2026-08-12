# Unit tests

## The rule

Every parser and every serializer gets Vitest coverage **including malformed
input** before it counts as done. This is not a style preference: the transcript
JSONL format is internal to Claude Code and documented to change between
releases, and `TASKS.md` is hand-edited by humans and agents alike. Both will be
fed garbage. The only question is whether that garbage crashes the dashboard.

## Path mapping

| Source | Test |
|---|---|
| `src/transcript/parse.ts` | `src/transcript/__tests__/parse.test.ts` |
| `src/tasks/parse.ts` | `src/tasks/__tests__/roundtrip.test.ts` |
| `src/server/<area>/x.ts` | `src/server/<area>/__tests__/x.test.ts` |

## Minimum per unit

1. **Happy path** — the shape you designed for.
2. **Error path** — malformed, truncated, wrong type, missing fields. The
   assertion is that it *degrades*, not that it throws.
3. **Boundary** — empty input, one element, a value at the limit.

`TASKS.md` additionally has a round-trip test: parse → serialize → parse must
yield an identical structure. It is the only guarantee that writing to a user's
backlog cannot quietly lose their data.

## Writing tests that mean something

- Test behaviour a user could notice, not the shape of the implementation.
- When a bug is found, write the failing test first, then fix it. A bug without
  a test is a bug that returns.
- Never weaken an assertion to make a test pass. If a test is wrong, say why in
  the change; if the code is wrong, fix the code.
