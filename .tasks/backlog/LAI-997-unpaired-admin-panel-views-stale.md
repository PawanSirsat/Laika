---
id: LAI-997
title: 'The admin panel views are paired now: drop four entries from the server census UNPAIRED list'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-988]
discovered-from: LAI-988
status: backlog
---

LAI-988 pairs `SignOutView`, `MembershipView` (as `PersonMembership`),
`ResetLinkView` and `PasswordResetView` with their web client types in
`server/web/test/api/view-type-drift.test.ts`. The server's census then
reports their `UNPAIRED` entries as stale — the entries' own comments say
*"the person admin panel (LAI-988) … bring[s] the mirrors"*. This is the
§4.4 two-owner case: the list is in CORE's file, so SHELL does not take it.

Red on LAI-988's branch (`server/`, `pnpm test`):

```
FAIL test/tooling/response-type-coverage.test.ts > every served response type is paired or named > names nothing that is already paired or no longer served
+   "SignOutView is paired now — remove it from UNPAIRED",
+   "MembershipView is paired now — remove it from UNPAIRED",
+   "ResetLinkView is paired now — remove it from UNPAIRED",
+   "PasswordResetView is paired now — remove it from UNPAIRED",
FAIL … > reports how much of the surface is actually guarded
AssertionError: expected 90 to be 86
```

The second is the first's consequence: the sum counts the four twice.

## Acceptance criteria

- [ ] `server/test/tooling/response-type-coverage.test.ts`: the four
      `UNPAIRED` entries `SignOutView`, `MembershipView`, `ResetLinkView` and
      `PasswordResetView` are removed, with the two comments that introduce
      them. That is the only edit.
- [ ] `npx vitest run test/tooling/response-type-coverage.test.ts` in
      `server/` exits 0 once merged with LAI-988.
