---
id: LAI-107
title: SPEC §4.8's type list is missing three verbs the server now writes
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-010]
discovered-from: LAI-010
status: backlog
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

- [ ] §4.8's `Types:` list includes `project.updated`, `project.archived` and
      `member.removed`, in the same order as `server/src/db/enums.ts`.
- [ ] The comment in `enums.ts` pointing at this task is removed.
- [ ] A note that archiving has its own verb, with the reason — an audit reader
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
