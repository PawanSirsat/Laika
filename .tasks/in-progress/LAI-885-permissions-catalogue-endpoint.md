---
id: LAI-885
title: 'No endpoint says what each role may do, so a Roles & Permissions screen would have to copy can() into the client'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T10:51:29Z
---

## Goal

The owner wants a Roles & Permissions screen (2026-10-22). Today the client
re-derives permissions in several hand-written predicates. Serve the matrix
from the server, **computed by calling `can()` itself**, so it can never
drift from policy.

## Acceptance criteria

- [ ] `GET /api/v1/permissions` returns, for every action in
      `server/src/policy/actions.ts` (org and project actions; **not**
      `system.*`): the action name, its scope (`org` | `project`), a
      human-readable label taken from SPEC §3.1/§3.2's row, and which built-in
      roles hold it (org roles `owner|admin|member|viewer`; project roles
      `lead|member|viewer`), plus flags for `session_only` and `read_only`
      (from `SESSION_ONLY_ACTIONS` / `READ_ACTIONS`).
- [ ] Role holding is computed by evaluating `can()` with a synthetic actor
      per role, not by a second table. Where `can()` needs a resource
      (e.g. `user.set_role`'s target role, own-vs-any), the response states
      the condition rather than guessing a yes/no — builder documents each
      such case.
- [ ] The response also carries the caller's effective grants
      (`me: { org_role, actions: [...] }`) so the client can stop
      reconstructing them.
- [ ] Guarded by `can()` with an existing action every signed-in role holds;
      builder names which and why in the log. Reachable by session and token.
- [ ] A test asserts, **by name from both sides**, that every action in
      `actions.ts` (minus `system.*`) appears in the response and vice versa.
- [ ] A test that flips one cell in `can()` (mutation) turns this endpoint's
      test red — checked, and the anchor confirmed to have landed.
- [ ] **Named cross-area edit (D-033):** add the endpoint's row to SPEC §6.4
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
