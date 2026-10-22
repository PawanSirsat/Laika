---
id: LAI-885
title: 'No endpoint says what each role may do, so a Roles & Permissions screen would have to copy can() into the client'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T10:51:29Z
finished: 2026-10-22T11:13:35Z
---

## Goal

The owner wants a Roles & Permissions screen (2026-10-22). Today the client
re-derives permissions in several hand-written predicates. Serve the matrix
from the server, **computed by calling `can()` itself**, so it can never
drift from policy.

## Acceptance criteria

- [x] `GET /api/v1/permissions` returns, for every action in
      `server/src/policy/actions.ts` (org and project actions; **not**
      `system.*`): the action name, its scope (`org` | `project`), a
      human-readable label taken from SPEC §3.1/§3.2's row, and which built-in
      roles hold it (org roles `owner|admin|member|viewer`; project roles
      `lead|member|viewer`), plus flags for `session_only` and `read_only`
      (from `SESSION_ONLY_ACTIONS` / `READ_ACTIONS`).
- [x] Role holding is computed by evaluating `can()` with a synthetic actor
      per role, not by a second table. Where `can()` needs a resource
      (e.g. `user.set_role`'s target role, own-vs-any), the response states
      the condition rather than guessing a yes/no — builder documents each
      such case.
- [x] The response also carries the caller's effective grants
      (`me: { org_role, actions: [...] }`) so the client can stop
      reconstructing them.
- [x] Guarded by `can()` with an existing action every signed-in role holds;
      builder names which and why in the log. Reachable by session and token.
- [x] A test asserts, **by name from both sides**, that every action in
      `actions.ts` (minus `system.*`) appears in the response and vice versa.
- [x] A test that flips one cell in `can()` (mutation) turns this endpoint's
      test red — checked, and the anchor confirmed to have landed.
- [x] **Named cross-area edit (D-033):** add the endpoint's row to SPEC §6.4
      Endpoints only. Nothing else in `docs/`.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 (repo root).

## Notes

Drives LAI-888 (web: Roles & Permissions screen). Also noted by the
investigation: `ACTIONS_WITHOUT_A_ROW` in
`server/test/tooling/policy-spec-drift.test.ts` still parks `presence.read` /
`capacity.read` as "LAI-432, in flight" though LAI-432 is done — **out of
scope here**; file it if still true.

## Renumbered

Filed by CHIEF on 2026-10-22 as `LAI-873`, which collided with a task already on
`origin/master` (the id sweep ran before `git fetch`). Commit `2274bfc9`
carries `[LAI-871]` for all five filings, and a claim commit `2c1a7274`
`[LAI-872]` (pushed as branch `LAI-872-share-activity-switch`) belongs to the
filing now LAI-884 — **neither is the task that holds that number now.**

## Submission notes (CORE, LAI-885)

**Gate: `pnpm lint` 0, `pnpm format` 0, `pnpm test` 1 — submitted red under
CLAUDE.md §4.4 step 1.** The one failure that is this change's:

```
server/web/test/api/endpoint-coverage.test.ts:261
not ok 1 - no endpoint is served, uncalled and unexplained
  served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
  + [ 'api/v1/permissions' ]
  - []
```

`NO_BROWSER_CALLER` is in `server/web/` (SHELL's), so there is no exemption
CORE can take that is not a crossing. The web Roles & Permissions screen
(SHELL; **no task id yet** — the `LAI-888` in Notes above is stale) turns it
green by calling the endpoint; a SHELL exemption entry naming that task would
too.

The follow-up for §3.1's missing *Presence and capacity* row was drafted and
**not filed** here, on CHIEF's instruction (LAI-890–899 belong to Strelka);
its text is in CORE's report for CHIEF to file.

The same run also failed eight server tests and one web test on time, not on
assertion — `Test timed out in 5000ms` in `sign-in-throttle`, `restore-drill`,
`presence`, `profiles`, `project-statuses`, and `the header took 1071.5 ms` in
`timeline-derive`. The load average was 80. Re-run on their own, all five
server files pass (162 tests) and `timeline-derive` passes 29/29. None
touch a file this task changed.

**Mutation (criterion 6)**, run against `server/test/services/permissions.test.ts`,
with the anchor counted (=1) and the file checksum compared before and after:
`sprint.manage` `isLead` → `isMemberUp` went red on the pinned matrix
(`"sprint.manage": "YNN"` vs `"YYN"`). A second mutation made `task.claim`
depend on `resource.ownerId`, and the undeclared-condition guard went red
(`task.claim for member/lead`). `can.ts` was restored byte-identical
(sha `17d931e9`).
