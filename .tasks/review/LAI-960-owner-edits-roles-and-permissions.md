---
id: LAI-960
title: 'Roles & permissions is read-only for everyone: the owner cannot switch capabilities on or off per role'
area: web
assignee: shell
priority: p1
depends-on: [LAI-958, LAI-950]
discovered-from:
status: review
started: 2026-10-22T14:08:41Z
finished: 2026-10-22T14:23:12Z
---

## Acceptance criteria

- [x] Organisation → Roles & permissions: the owner sees a **Who can do what**
      grid — each grantable capability × Admin / Member / Viewer as switches,
      Owner column always on and locked, owner-locked items listed as such —
      Save sends `PUT /org/permissions`; errors shown inline. Everyone else
      sees it read-only.
- [x] Organisation → People: the role picker is shown to the owner only;
      admins see roles read-only. Invite form offers admins only the roles the
      server allows.
- [x] The matrix tables from LAI-950 reflect grants (re-read after save).
- [x] Every string from the server; light/dark, 1440/390; browser tests for
      owner edit round-trip, admin read-only, member read-only.
- [x] Gate: `pnpm test` / `lint` / `format` exit 0 with LAI-958 merged.

## Submitted red, by §4.4 (LAI-960)

The client now declares and pairs `OrgPermissionsView`, `CapabilityView` and
`OwnerLockedView` in `server/web/test/api/view-type-drift.test.ts`, so the
server's census goes red until CORE drops the three `UNPAIRED` entries LAI-958
added in `server/test/tooling/response-type-coverage.test.ts`. That file is
CORE's and is not edited here. The exact failures from the repo-root
`pnpm test`:

```
FAIL test/tooling/response-type-coverage.test.ts > every served response type is paired or named > names nothing that is already paired or no longer served
+   "OrgPermissionsView is paired now — remove it from UNPAIRED",
+   "CapabilityView is paired now — remove it from UNPAIRED",
+   "OwnerLockedView is paired now — remove it from UNPAIRED",
FAIL test/tooling/response-type-coverage.test.ts > every served response type is paired or named > reports how much of the surface is actually guarded
AssertionError: expected 80 to be 77
```

Removing those three entries turns both green: the second is the same three
types counted twice. No other failure comes from this change. Two load
timeouts in the same run (`restore-drill` "is taken while writes are in
flight", 5000 ms; web `timeline-derive` "the widest drawable window steps by
month and week", header 1497.5 ms) both pass when re-run alone.
