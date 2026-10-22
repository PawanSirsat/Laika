---
id: LAI-963
title: 'Local activity is collected only when the person opts in; D-102 (amended) makes the organisation''s switch alone decide'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-22T13:33:37Z
finished: 2026-10-22T13:51:31Z
---

## Goal

D-102 amendment, server half: when the org's Developer insights is on, the
server accepts and stores every connected machine's local activity and the
owner/admin reads see it, whatever the person's `share_local_activity` says.

## Acceptance criteria

- [x] Census (untruncated) of every place `share_local_activity` /
      `activity_sharing` gates collection, sync, storage, or reading
      (`services/local-activity.ts`, `profiles.ts`, `people-activity.ts`,
      `permissions.ts`, `can.ts`, `actions.ts`, sync/ingest routes) — listed
      in the log with the decision for each.
- [x] Sync/ingest no longer refuses for the person's switch; it still refuses
      when the org switch is off. Reads (heatmap series, profile, LAI-957's
      mirror) no longer return `null` for the person's switch — only for the
      org switch off.
- [x] `GET /me/activity-sharing` (or its successor) tells the client the
      truth: `org_enabled`, and that collection is organisation-controlled
      (`person_can_opt_out: false` or equivalent — smallest honest shape;
      document it). `PUT /me/activity-sharing` answers a clear refusal code
      (or is removed) — builder chooses, says why, keeps CLI compatibility in
      mind (the CLI half is LAI-964).
- [x] Policy: `activity_sharing.set_own` retired or made inert consistently
      across can.ts / actions.ts / SPEC §3.1 / LAI-885's catalogue.
- [x] **Named cross-area edits (D-033):** SPEC §3.1 row(s) for activity
      sharing, the §4 column note for `share_local_activity`, and §6.4 lines
      for `/me/activity-sharing`. Nothing else in `docs/`.
- [x] Tests red first; refusal codes asserted; existing per-person data kept.
- [x] Gate; web/CLI drift failures quoted per §4.4 (other half LAI-964).

## Builder notes (CORE, 2026-10-22)

**The other half is LAI-964 — this branch is red by one assertion, by design
(§4.4 step 1).** `pnpm test` exits 1 on exactly one test, in `server/web/`,
whose exemption list (`clientOmits`) is SHELL's, so there is no entry this
half could take that is not a crossing:

```
server/web/test/api/view-type-drift.test.ts:660
not ok 2 - no server field is missing from its client type
  ActivitySharingView.person_can_opt_out is served and ActivitySharing does not
  declare it — add it, or list it in clientOmits with a reason
(parent: not ok 213 - every server field is visible to the client)
```

LAI-964 turns it green by declaring `person_can_opt_out` on the client's
`ActivitySharing`. No other test fails: server 3508 passed / 10 skipped,
cli 598 pass / 0 fail / 2 skipped, web 2910 pass / 1 fail.

**What the server says now**

- `GET /me/activity-sharing` → `{ org_enabled, enabled, person_can_opt_out:
  false, scope, min_sync_interval_s }`. `enabled` equals `org_enabled`: it is
  whether this person's activity is collected. Kept rather than removed so an
  installed CLI (which syncs on `org_enabled && enabled`) syncs exactly when
  it may, before LAI-964 ships.
- `PUT /me/activity-sharing` with `enabled` (on or off, either org state) →
  `403 forbidden`, `details: { reason: "organisation_controlled",
  org_enabled }`, nothing written, `scope` included. `{ scope }` alone still
  works, session only. A token still gets `session_required` first.
- Ingest (`PUT /me/local-activity` snapshot, look-back, usage) and `POST
  /otlp/v1/metrics` refuse `403 local_activity_off` only when the
  organisation's switch is off; details now `{ reason, org_enabled: false,
  enabled: false }`.
- The heatmap, profile `activity_sharing` and usage card `sharing` are both
  the organisation's switch.
- `users.share_local_activity` is kept, read by nothing, written by nothing;
  existing rows untouched.
