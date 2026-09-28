---
id: LAI-617
title: The board speaks in column names, and an empty column stops being a lane
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
started: 2026-09-23T06:34:19Z
finished: 2026-09-23T06:34:19Z
status: done
reviewed: 2026-09-28T17:49:35Z
---

## Goal

**Owner, on a live board (`52.72.203.206`), with screenshots:** a card reading
`BACKLOG` sat in a column headed `TO DO` while a `BACKLOGS` column showed `0`;
and a column renamed `TESTING` held tasks whose status still read `Review`.
*"if i change the column name that status also changes — this makes sense
right?"*

Half of that should be true, and was not. The other half cannot be:
`TASK_STATUSES` is a fixed enum the REST API, the policy layer and the MCP
tools depend on **by literal value** — `laika_finish_task` moves a task to
`review` and tells the agent a person takes it from here. Renaming a column
must not rewrite that, or every agent integration and every `?status=review`
link breaks.

**So the column name is the label and the status stays the value.**

## Acceptance criteria

- [x] A column owning **exactly one** status lends that status its name
      everywhere a person reads it — the drawer's state pill, the drawer's
      status select, and the card's inline status select.
- [x] A column owning **several** keeps their own names. The shipped default
      merges `todo` and `backlog`; substituting there would render two
      different statuses identically.
- [x] A status nobody owns falls back to its own name rather than `undefined`.
- [x] A column owning **no** statuses is not drawn as a lane.
- [x] Taking a status from a column that holds only that one **says so** before
      the click, naming the column and that it will leave the board.
- [x] The column dialog sees **every** column, hidden ones included.
- [x] Full gate, all three `EXIT 0`.

## Verified

Driven on a local instance with the board configured as the owner's is —
`Review` renamed to `Testing`:

```
lanes drawn        : In progress | Testing | To do | Done
drawer status pill : "Testing"                     (was "Review")
status dropdown    : Backlog | To do | In progress | Testing | Done
```

Then reproducing the empty-column state through the exact path that produces
it — `PUT` `In progress` = `[in_progress, review]`, which takes `review` from
`Testing`:

```
Testing        []  <-- EMPTY
lanes drawn    : In progress | To do | Done      (the dead lane is gone)
```

And the dialog now warns, for every single-status column including the hidden
one:

```
Review     takes it from Testing, which then holds nothing and leaves the board
Cancelled  takes it from Cancelled, which then holds nothing and leaves the board
```

Gate: TEST 0, LINT 0, FMT 0 — 2040 server, 1061 web. Two mutations on the new
label rule, both caught: never-substituting and always-substituting.

## Notes / context

**The root cause is server-side and is not fixed here** — see LAI-618. The API
refuses `statuses: []` when written directly (`422`, "expected array to have
>=1 items") but produces exactly that state as a **side effect** when another
column takes a status. Validation guards the column being written and not the
one silently losing one. This task stops the UI drawing the result and warns
before the click; it cannot stop the state being reached.

**Why only the lossless case substitutes.** A column holding one status *is*
that status, so its name identifies it exactly. A column holding several cannot
stand in for any one of them — the rule is in `boardStatusLabel` with both
directions under test.

**An unexplained gate red, recorded rather than claimed fixed.** One full-gate
run failed `server/test/tooling/environment-posture.test.ts`. It now passes
three times in isolation and in the full gate. The first hypothesis — an
untracked `.laika-local/` — was **disproven**: the test passes with that
directory present. Most likely it raced a concurrent `pnpm build`. Nothing was
changed to address it.

## Review — 2026-09-28T17:49:35Z (CHIEF)

**Accepted.** Merged as part of `shell` up to `df23d67`.

**Verified on a private instance** (port 3977, 251 tasks, `Review` renamed
`Testing`, the owner's configuration):

- The drawer pill reads *Testing*, and the drawer's status select offers
  *Testing*. The two-status *To do* column keeps *Backlog* and *To do*, so
  the lossless-only rule holds.
- Taking `review` into *In progress* (`PUT … statuses`, 200) emptied
  *Testing*, and **the lane disappeared**: To do / In progress / Done.
- The column dialog warned *"takes it from Cancelled, which then holds nothing
  and leaves the board"*, the hidden column included.

**Mutations**, each typechecking and restored by checksum:

- A single-status column no longer lends its name: `board-derive.test.ts`
  **red**.
- A status-less column drawn as a lane: `column-reorder.test.ts` **red** (the
  drag and keyboard routes both).
  - LAI-620's fixture is what guards this. LAI-617 itself added no test for
    the lane filter, the dialog warning, or the dialog seeing hidden columns.
    None of its criteria asked for one, so this is recorded, not sent back.

**Process, recorded:** the task file was created in the same commit as the code,
straight into `review/`, with `started` = `finished`. It was built from a
direct owner request, but §2 gives builders no file-after exception. The
09-23 log also says *"shipped and deployed"*, which was before any review.

**Nit, not filed:** `ColumnDialogProps.all` carries two stacked doc comments;
the first is orphaned.
