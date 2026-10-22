---
id: LAI-965
title: 'SPEC still says "both switches" for local activity outside the lines LAI-963 was allowed to touch'
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-963]
discovered-from: LAI-963
status: backlog
---

## Goal

LAI-963 made local-activity collection follow the organisation's switch alone
(D-102 amended) and was allowed to edit only SPEC §3.1's row, §4.1's
`share_local_activity` note and §6.4's `/me/activity-sharing` lines (D-033).
The rest of SPEC still describes D-079's two switches for local activity.
Measured on LAI-963's branch with
`grep -nE "both switches|either switch|two switches|both of D-084|own sharing|turned sharing" docs/SPEC.md`
(untruncated); line numbers are that branch's.

## Acceptance criteria

- [ ] Each line below either follows D-102 (amended) or is confirmed to be
      about a different pair of switches (time drafts, D-089), and says so:
  - §3.1 prose, ~257–259 — "it is the two switches … `share_local_activity`
    (§4.1) — which the service reads on every report".
  - §3.1 prose, ~294 and ~323 — usage/OTLP "under the same … two switches",
    "both switches on every send".
  - §4.2 `developer_insights`, ~488 — "the organisation's half of D-079's two
    switches … whatever they chose" (true, but "half" is stale).
  - §4.23 `commits_local` ~1143 and ~1158, §6.4 ~2678 — "after they turned
    sharing on": the collector's start point is now `laika activity on` on a
    connected machine (LAI-964 decides the CLI's wording).
  - ~1904 — agent minutes "under its two switches".
  - §6.4 endpoint block ~2319 (`PUT /me/local-activity`) and ~2323 (`POST
    /otlp/v1/metrics`) — "(both switches on …)".
  - §6.4 profile `activity_sharing` row ~2499 — "their own sharing". Served
    now: `{ org_enabled, enabled }`, both the organisation's switch.
  - §6.4 heatmap ~2528 — "unless both switches are on for that person now".
  - §6.4 refusals ~2665 — "`403 local_activity_off` when either switch is
    off". Served now: only the organisation's, details
    `{ reason, org_enabled: false, enabled: false }`.
  - §11 screens ~4444 and ~4448 — "when the person has not turned on sharing",
    "when either switch is off" (SHELL's screens follow in LAI-964).
  - ~4748 — OTLP "under the same two switches".
