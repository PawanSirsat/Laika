---
id: LAI-1343
title: 'CLI: take the board URL and its token from one source, never mixed'
area: cli
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-1325
status: review
started: 2026-11-18T09:48:56Z
finished: 2026-11-18T10:03:31Z
---

## Goal

Found by review-1325 on PR #376; the bug predates it and is on `master`. Board card LAIKA-1100.

`findCredentials` (`cli/src/activity-sync.ts`) picks `LAIKA_URL` and `LAIKA_TOKEN` separately
across its sources. With `LAIKA_URL=B` in the environment and no token there, while
`~/.laika/env` holds board C's URL and token, `laika activity on` sends C's token to host B.

**Fix:** the URL and the token are taken as a pair from one source. A URL from one source is
never paired with a token from another. Sweep every CLI caller of `findCredentials`, and any
lookup like it, as a census rather than a single patch.

## Acceptance criteria

- [x] A test with the environment's URL for board B and `~/.laika/env`'s URL and token for board
      C sends nothing to B, or uses C.
- [x] Every lookup site is listed in the PR as checked.

## Notes

- **Scope:** `cli/`, and one named plugin file, `plugin/scripts/laika-claude`: the census found
  it pairs the two names across `~/.laika/env` and the environment. Its tests sit beside its
  others, in `cli/test/plugin-install.test.ts`.
- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR. CHIEF merges.
