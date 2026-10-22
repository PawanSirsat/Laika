---
id: LAI-963
title: 'Local activity is collected only when the person opts in; D-102 (amended) makes the organisation''s switch alone decide'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

D-102 amendment, server half: when the org's Developer insights is on, the
server accepts and stores every connected machine's local activity and the
owner/admin reads see it, whatever the person's `share_local_activity` says.

## Acceptance criteria

- [ ] Census (untruncated) of every place `share_local_activity` /
      `activity_sharing` gates collection, sync, storage, or reading
      (`services/local-activity.ts`, `profiles.ts`, `people-activity.ts`,
      `permissions.ts`, `can.ts`, `actions.ts`, sync/ingest routes) — listed
      in the log with the decision for each.
- [ ] Sync/ingest no longer refuses for the person's switch; it still refuses
      when the org switch is off. Reads (heatmap series, profile, LAI-957's
      mirror) no longer return `null` for the person's switch — only for the
      org switch off.
- [ ] `GET /me/activity-sharing` (or its successor) tells the client the
      truth: `org_enabled`, and that collection is organisation-controlled
      (`person_can_opt_out: false` or equivalent — smallest honest shape;
      document it). `PUT /me/activity-sharing` answers a clear refusal code
      (or is removed) — builder chooses, says why, keeps CLI compatibility in
      mind (the CLI half is LAI-964).
- [ ] Policy: `activity_sharing.set_own` retired or made inert consistently
      across can.ts / actions.ts / SPEC §3.1 / LAI-885's catalogue.
- [ ] **Named cross-area edits (D-033):** SPEC §3.1 row(s) for activity
      sharing, the §4 column note for `share_local_activity`, and §6.4 lines
      for `/me/activity-sharing`. Nothing else in `docs/`.
- [ ] Tests red first; refusal codes asserted; existing per-person data kept.
- [ ] Gate; web/CLI drift failures quoted per §4.4 (other half LAI-964).
