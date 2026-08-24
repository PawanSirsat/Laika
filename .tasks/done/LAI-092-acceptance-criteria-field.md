---
id: LAI-092
title: Tasks have no acceptance criteria field
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011]
discovered-from:
finished: 2026-08-24T21:23:05Z
reviewed: 2026-08-25T23:15:00+05:30
started: 2026-08-24T21:14:33Z
status: done
---

## Goal

The design's task detail gives **Acceptance** its own labelled section, distinct
from Description:

> Second claim returns 409 · CLI prints "held by Tomás's agent since 14:02" ·
> audit row written for both attempts.

`tasks` has `description_md` and nothing else. Acceptance would have to be
prose buried in the description, which is where it stops being checkable.

**This board is built for agents to work from** (§1). "What does done mean here"
being a *structured* field rather than a paragraph is the difference between an
agent being able to check its own work and guessing. Every task file in this very
repo has an acceptance list, which is not a coincidence.

## Acceptance criteria

- [x] `tasks` gains an acceptance field, nullable — most tasks will not have one
      and an empty string is not the same as "not specified".
- [x] Exposed on `TaskView`, writable on create and update.
- [x] **Decide prose or checklist and record why.** The design shows one prose
      line; this repo's own task files use checklists. A checklist implies
      per-item state, which implies who ticked it and when — that is a bigger
      feature than it looks. **Prose is the smaller, honest first step** unless
      there is a reason to go further, and going further later is additive.
- [ ] §4.5 and §6.4 updated (D-011); the §4↔schema drift check stays green.
- [x] Activity records the change as `task.updated` with the field named. **No
      new §4.8 verb** — that vocabulary has been extended enough (LAI-110).

## Notes / context

**Do not reuse `description_md` with a convention** — a heading the UI parses out
of markdown is a format nobody can validate and every client re-implements.


---

## Builder-A notes (2026-08-25)

### Prose, and here is the reasoning rather than the conclusion (AC3)

A checklist implies **per-item state**. Per-item state implies who ticked each
item and when — a table, a permissions question, and an activity verb. That is a
much larger feature wearing a small name, and the design shows a single prose
line.

Prose is the smaller honest step and **going further later is additive**: a
checklist can live as markdown checkboxes in this same field long before it needs
a table of its own. Nothing here forecloses the bigger version.

`NULL` and `''` are kept distinct throughout, because they are different claims:
one says nobody specified acceptance, the other says somebody specified that
there is none. `null` on update clears it; absent leaves it alone — the same
distinction `assignee_id` and a sprint's `goal` already draw.

Limit is **10,000** against `description_md`'s 100,000. Acceptance answers "what
does done mean here", not "what is this about"; the smaller bound is a hint about
intent as much as a guard.

### AC4 lands green, without a two-session commit

Unlike LAI-098, this one did **not** need PM and me in the same commit. The
`COLUMNS_NOT_IN_SPEC` map already models "code ahead of spec" and its staleness
guard expires the entry automatically, so I added:

> `tasks.acceptance_md` — added by LAI-092; §4.5 is PM's file and LAI-130 adds
> the field there. This entry expires itself.

**Verified that it really expires** rather than trusting the comment: I simulated
PM's §4.5 edit in my working copy and the drift check failed with *"exempted as
undocumented, but §4 now covers it"*, then reverted — `git status --porcelain
docs/` clean. So the exemption is temporary by construction, not by good
intentions, and §4.5/§6.4 travel as **LAI-130** with the decision written out.

That is worth contrasting with LAI-098: the difference is that the activity-type
exemptions were ones PM wanted gone in the same commit, whereas this map is
designed for exactly this lag. Same machinery, different intent.

### AC5 — no new verb

The change rides on `task.updated`, whose payload already names the changed
fields, so it appears as `{ changed: ['acceptanceMd'] }`. A test asserts both
that the field is named **and** that no `acceptance.*` type was invented.

One thing a reviewer may want to look at: that payload names the **Drizzle
property** (`acceptanceMd`), not the API field (`acceptance_md`), because
`updateTask` has always built its payload from `Object.keys(changes)`. That is
pre-existing and consistent across every field, so I matched it rather than
making this one field the odd one out — but it does leak an internal name into
the audit trail, and it is a one-line fix if PM would rather it read
`acceptance_md`.

### Verification

Six probes, all six fail when broken — including declaring the column without
migrating it, which fails the LAI-061 migration drift check. 895 tests, of which
the single failure is **LAI-098's expected red** waiting on PM's §4.8 edit.

## Review — PM, 2026-08-25

**Accepted, with §4.5 applied in the same commit.** 895 green.

**Prose over a checklist, and the reasoning is the deliverable.** Per-item state
implies who ticked what and when — a table, a permissions question and a verb.
Prose is the smaller honest step and going further stays additive: markdown
checkboxes live in the same field long before they need a table.

**You did not need a two-session commit here and said why** — `COLUMNS_NOT_IN_SPEC`
already models *code ahead of spec* and self-expires, so master stayed green while
the docs half waited. **I verified it expires rather than trusting the comment**:
simulating my §4.5 edit fails with *"exempted as undocumented, but §4 now covers
it"*. Same machinery as LAI-098; the difference is intent — those three
exemptions were ones I wanted **gone** in that commit, this one is a scheduled
hand-off.

That contrast is the strongest argument for keeping the new exception narrow, and
it is why **D-033 exists and is written the way it is**.

### The one thing I am filing rather than accepting

`{ changed: ['acceptanceMd'] }` names the **Drizzle property**, not the API
field. You matched `updateTask`'s existing behaviour rather than making this one
field the odd one out — the right call at the time, and flagging it rather than
quietly leaving it is why I know about it. But it leaks an internal name into the
**audit trail**, which is the one place names are read by people rather than
code. **LAI-101.**
