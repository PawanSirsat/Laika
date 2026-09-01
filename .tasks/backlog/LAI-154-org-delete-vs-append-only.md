---
id: LAI-154
title: '`org.delete` cannot run while `activity` is append-only'
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-135
status: backlog
---

## Goal

Settle what `org.delete` means, because **it cannot be implemented as written**
and nobody has noticed only because nothing calls it yet.

`org.delete` is a real action: it is in `POLICY_ACTIONS` (`src/policy/actions.ts`)
and has a case in `can()` (`src/policy/can.ts:108`). SPEC §3.1 grants it to the
owner as *"delete org data / transfer ownership"*. **Nothing implements it** —
there is no route, no service, no `db.delete(orgs)` anywhere in `server/src`.

`activity.org_id` is `ON DELETE cascade`. Deleting the org would cascade-delete
its activity rows, and §4.8's append-only trigger refuses every DELETE. Measured,
not reasoned about:

```
activity is append-only: DELETE is not permitted (SPEC 4.8)
```

This is **not** LAI-135's problem and was deliberately left alone by it. LAI-135
concerned three `ON DELETE set null` cascades, which are UPDATEs — an edit to a
record that must not be edited — and they became `restrict`. A cascade *delete*
of an org's audit log alongside the org is arguably correct: the log is *of* that
org, and deleting an org that keeps its audit log forever is its own kind of
wrong. So the answer here is genuinely open in a way LAI-135's was not.

## The decision to make

One of:

- **`org.delete` is not a thing Laika does.** A single-org, self-hosted board
  deletes by deleting the SQLite file. Then the action should go from §3.1 and
  from `POLICY_ACTIONS`, and the `can()` case with it. Note that §3.1 pairs it
  with *"transfer ownership"*, which **is** implementable and would need to
  survive as its own action if the delete half goes.
- **`org.delete` stays and the trigger is dropped for that one path.** Needs a
  named mechanism — the triggers are re-established every boot by
  `ensureActivityTriggers` (LAI-118), so "drop it and delete" is not a thing a
  handler can do casually, and a way to switch off the append-only guarantee is
  exactly the thing §4.8 exists to prevent.
- **`org.delete` means something narrower than deleting the row** — deactivate,
  export-then-wipe-projects, transfer only. Then §3.1's wording should say so.

## Acceptance criteria

- [ ] SPEC §3.1's `org.delete` row says which of the three it is, in a sentence
      that names the append-only constraint as the reason.
- [ ] If the action goes, it goes from `docs/SPEC.md`, `src/policy/actions.ts`
      and `src/policy/can.ts` together, and the `policy-spec-drift` check stays
      green across the pair. Transfer-of-ownership is considered separately and
      not lost by accident.
- [ ] If the action stays, a task exists for the mechanism, and it names how the
      append-only guarantee survives it.
- [ ] Either way, the `activity.org_id` cascade is stated deliberately. It is
      currently `ON DELETE cascade` and pinned by a test in
      `test/db/activity.test.ts` that asserts the schema says so.

## Notes

Found while building LAI-135. It is filed as `area: docs` because the first move
is a SPEC decision, not code — the code change is small once the sentence exists,
and is at most two files plus a drift check.

Do not resolve this by relaxing the trigger. That is the one option LAI-135 was
explicitly told not to take, and it is no more available here.
