---
id: LAI-1145
title: 'Pair the availability, load and notice views in view-type-drift, and take them out of UNPAIRED'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-1139]
discovered-from: LAI-1139
status: backlog
---

## Goal

LAI-1139 gave the client its own types for what LAI-1130 and LAI-1136 serve
(`server/web/src/api/availability.ts`, `server/web/src/api/notices.ts`), but
did not pair them in `server/web/test/api/view-type-drift.test.ts`. Pairing
them on the web side alone reddens the server's census
(`server/test/tooling/response-type-coverage.test.ts`), whose `UNPAIRED`
still lists every one of them as *"no client type exists"*, and that list is
CORE's. Until both halves land, a field added to any of these views can be
served and never seen — the defect LAI-213 exists for.

## Acceptance criteria

- [ ] `view-type-drift.test.ts` `PAIRS` pairs `AvailabilityView` →
      `Availability`, `AvailabilityRowView` → `AvailabilityRow`,
      `PersonLoadView` → `PersonLoad`, `LoadProjectView` → `LoadProject` and
      `NoticeView` → `Notice` (and the nested views the census counts), with
      a `clientOmits` reason for any field deliberately not declared.
- [ ] The matching entries leave `UNPAIRED` in
      `server/test/tooling/response-type-coverage.test.ts` in the same merge.
- [ ] Both files green at once — the CLAUDE.md §4.4 two-owner procedure.

## Notes / context

Two owners: the `PAIRS` entries are SHELL's (`server/web/test/`), the
`UNPAIRED` entries CORE's (`server/test/`). Split it, or hand it to one
builder with the `UNPAIRED` lines named as a crossing (D-033).
`MemberAvailabilityView` and `LeadAvailabilityView` are both covered on the
client by one `AvailabilitySeen` with optional fields; the pair may need to
say so rather than name three client types.
