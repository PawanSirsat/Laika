---
id: LAI-051
title: Nothing catches drift between SPEC §4 and schema.ts
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-105
status: done
started: 2026-08-24T10:11:45+05:30
finished: 2026-08-24T10:20:22+05:30
reviewed: 2026-08-24T14:30:00+05:30
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

- [x] A check that fails when §4 and `schema.ts` disagree, in **both**
      directions: a column §4 specifies that the schema lacks, and a column the
      schema has that §4 never mentions.
- [x] It reads both real sources. Follow LAI-105's shape — derive from the
      artefacts, not from a hand-kept list that drifts the same way.
- [x] Runs in `pnpm test`.
- [x] **Confirmed able to fail** in both directions. `presence_enabled` is the
      known miss; adding it should turn one failure green without hiding others.
- [x] Failure messages name the table, the column and the direction.
- [x] An exemption list with reasons, kept honest the way LAI-038 and LAI-105 keep
      theirs.

## Added by PM — 2026-08-24: cover §4.8's type vocabulary too

Same drift class, same reader, so it belongs in the same check rather than a
second one:

- [x] Fails when `ACTIVITY_TYPES` in `server/src/db/enums.ts` and SPEC §4.8's
      type list disagree, **in both directions**.
- [x] Same for `ACTOR_KINDS` and §4.8's `actor_kind` row.

**Four verbs have gone missing from §4.8 so far** — LAI-044's `org.created`,
LAI-010's `project.updated`/`project.archived`/`member.removed`, and
`task.dependency_removed` (LAI-110). Each was found by a builder discovering
mid-task that a mutation had no verb, because tasks get written against a section
listing *nouns* without checking the verbs each mutation needs. The list and the
enum drifting apart is the mechanical half of that; this catches it.

The CHECK constraint is the enforcement and §4.8 is the description (§4.8 says so
now), so when they disagree the constraint wins and the doc is the bug — the check
should say which side it thinks is wrong.

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

---

## Notes at review — builder-a

`server/test/tooling/schema-spec-drift.test.ts`, 17 tests. **632 total**; format,
lint, typecheck clean.

**What it found on its first run, which is the only real evidence it works:**

| finding | direction | status |
| --- | --- | --- |
| `orgs.presence_enabled` | §4 has it, schema does not | exempted → **LAI-207** |
| `projects.repo` | §4 has it, schema does not | exempted → **LAI-108** |
| `task.dependency_removed` | enum has it, §4.8 does not | exempted → **LAI-114 filed** |
| `users.email_verified`, `users.image` | schema has them, §4 does not | exempted — better-auth's model (§11.3) |
| `sessions`, `accounts`, `verifications`, `idempotency_keys` | tables with no §4 section | exempted with reasons |

**1. I probed ten ways of being wrong and every one fails the check.** Both column
directions, both activity-type directions, a new §4 table, a missing §4 table, an
`actor_kind` dropped from §4.8, the §4 preamble losing the timestamp convention,
and — the one I care about most — **a sabotaged parser.** Making the parser return
no fields fails four tests including the two that exist purely to check the
parser; making it handle tables but silently skip the prose format fails four.
A check like this passing because it read nothing is the obvious failure mode, so
it is the one with the most tests pointed at it.

**2. The presence_enabled case behaves as the task asked.** Adding the column to
`schema.ts` turns the drift green and turns the *exemption* red — one failure,
naming the entry to delete. The list cannot rot in the direction of hiding a fixed
bug.

**3. §4 is written in two formats and I did not want to change either.** Seven
sections are Markdown tables, seven are a prose sentence (`` `id`, `user_id`, … ``).
Both are parsed. The prose rule is deliberately narrow — "the first paragraph
opening with a backticked identifier **followed by a comma**" — because §4.6's
second paragraph opens `` `discovered_from` is a different relationship ``, which
any looser rule sweeps in, and §4.14's field list is its *second* paragraph, which
any "first paragraph" rule misses. Both are asserted directly.

**4. Parsing, where LAI-105 ran the artefact instead.** Worth naming as a
difference rather than a lapse: `env-contract.test.ts` discovers what the server
reads by running `readEnv` behind a Proxy, which beats parsing because it sees
what the code does. There is no equivalent for a Markdown document. Parsing is
acceptable here precisely because **the document is the artefact** — parsing
SPEC.md *is* reading the spec, whereas parsing `env.ts` would only have been
guessing at code that could be run. The schema half is still executed:
`getTableConfig` reports the columns Drizzle will emit.

**5. `created_at` / `updated_at` are licensed by §4's preamble, not by me.** The
preamble names them as the convention for every table, so the schema having them
where §4 does not list them is not drift. A test re-reads that sentence — if it
is ever removed from §4, the exemption stops being justified and this fails.

**6. One judgement call worth your eye.** Escaped pipes inside a table cell
(`` `user` \| `agent` \| `system` ``) mean `split('|')[2]` truncates the cell at the
first alternative — which reported a three-value vocabulary as one value and
looked like a real §4.8 bug. Caught because the actor-kind test failed on the
first run; the shape of the bug is worth remembering, because it fails *quietly*
in the safe-looking direction anywhere else it is used.

**Not done, deliberately:** none of the three real drifts is fixed here. Two are
`docs/` and one needs a schema column; all three have tasks, and reconciling them
inside this task would have hidden the evidence that the check works.

## Review — PM, 2026-08-24

**Accepted.** Verified it can fail: I removed `projects.repo` from `schema.ts`
and got **2 failures**, with the message naming both the object and the
direction — *§4 specifies projects.repo — schema.ts has no such column (the spec
is ahead of the code)*. The direction matters; "these differ" would not have told
anyone which to change.
