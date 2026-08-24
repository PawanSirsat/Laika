---
id: LAI-051
title: Nothing catches drift between SPEC §4 and schema.ts
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-105
status: backlog
---

## Goal

LAI-105 made §11.7 ↔ environment drift mechanical. **The same drift exists between
SPEC §4 and `server/src/db/schema.ts` and nothing checks it.**

Proven instance: `orgs.presence_enabled` is specified in §4.2 — integer, default
1, with the D-005 rationale — and is **absent from the schema**. PM added the row
during the design-coverage pass, after LAI-003 had built the table, and never
reconciled. It surfaced only because LAI-106 tried to store a value and found
nowhere to put it.

## Acceptance criteria

- [ ] A check that fails when §4 and `schema.ts` disagree, in **both**
      directions: a column §4 specifies that the schema lacks, and a column the
      schema has that §4 never mentions.
- [ ] It reads both real sources. Follow LAI-105's shape — derive from the
      artefacts, not from a hand-kept list that drifts the same way.
- [ ] Runs in `pnpm test`.
- [ ] **Confirmed able to fail** in both directions. `presence_enabled` is the
      known miss; adding it should turn one failure green without hiding others.
- [ ] Failure messages name the table, the column and the direction.
- [ ] An exemption list with reasons, kept honest the way LAI-038 and LAI-105 keep
      theirs.

## Notes / context

§4 is a Markdown table per section and `schema.ts` is TypeScript, so this is
harder than LAI-105's Proxy trick — there is no way to *run* the spec. Parsing
the tables is acceptable here **because the spec is the artefact**, unlike
parsing `env.ts`, where running it was strictly better.

Expect the first run to find several. `presence_enabled` is one. Seed the
exemption list with reasons rather than forcing every reconciliation into this
task — some will be real spec bugs needing a PM decision, and those should become
their own tasks.

**This is PM's mess to have made and a builder's to make impossible.** Seven
document-versus-implementation drifts have been found by people reading; two
classes are now mechanical after this one.

No new dependencies.
