---
id: LAI-107
title: SPEC §4.8's type list is missing three verbs the server now writes
area: docs
assignee: pm
priority: p2
depends-on: [LAI-010]
discovered-from: LAI-010
status: done
started: 2026-08-24T10:20:00+05:30
finished: 2026-08-24T10:25:00+05:30
reviewed: 2026-08-24T10:25:00+05:30
---

## Goal

LAI-010 needed an activity verb for every mutation it performs (§4.8 is the audit
trail, and AC6 required one per mutation). Three did not exist, so `enums.ts` and
the `activity` CHECK constraint gained them:

- **`project.updated`** — settings, description, visibility, `context_md`
- **`project.archived`** — its own verb, not a payload flag on `project.updated`
- **`member.removed`** — the counterpart to `member.added`

SPEC §4.8's type list still shows the older set. The code is the stricter of the
two — the CHECK constraint rejects anything not in `enums.ts` — so the risk is not
that a bad row lands, but that §4.8 stops being a reliable description of the
audit vocabulary.

## Acceptance criteria

- [x] §4.8's `Types:` list includes `project.updated`, `project.archived` and
      `member.removed`, in the same order as `server/src/db/enums.ts`.
- [x] The comment in `enums.ts` pointing at this task is removed.
- [x] A note that archiving has its own verb, with the reason — an audit reader
      should not have to diff a payload to discover a project left every active
      view.

## Notes / context

Same shape as `org.created` in LAI-044 and the error codes in LAI-022: a task
needed a value from a closed vocabulary that the vocabulary did not have. Third
occurrence, so it may be worth a check that `enums.ts` and §4.8 agree, the way
`test/errors.test.ts` now parses §6.3's table. **Not filed as its own task** —
mention it here and let PM decide whether it earns one.

**`member.removed` is load-bearing beyond the audit trail.** Membership rows are
hard-deleted, so `?updated_since=` cannot return a tombstone for one — there is no
row left to mark. The activity row is the only way a catching-up client learns a
member was removed. Worth stating in §4.8 rather than leaving it to be rediscovered.

No new dependencies.

---

## Resolution — PM, 2026-08-24

**Done.** SPEC §4.8 now lists `project.updated`, `project.archived` and
`member.removed`.

**Your call to give `project.archived` its own verb was right**, and §4.8 now says
why: archiving removes a project from everyone's board and a settings edit does
not. Answering "when did this project disappear?" should not mean inspecting the
payload of a generic update.

**You extended the vocabulary during LAI-010 and filed the docs half rather than
editing `docs/`.** That is the correct handling — the same shape as LAI-030 →
LAI-104 — and it is the fourth time a builder has hit one of my criteria that
could not be met without crossing an area boundary. AC6 required an activity row
per mutation, three verbs did not exist, and §4.8 is closed. There was no path
that did not involve extending it.

**I accepted LAI-010 without noticing the vocabulary had grown.** The verbs were
in the diff and I checked the layering, the routes and the permission matrix
instead. §4.8 now states that `enums.ts` and the CHECK constraint are the
enforcement and the list is the description — so if this drifts again, the
constraint wins and the list is the bug.
