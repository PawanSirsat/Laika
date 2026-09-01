---
id: LAI-415
title: A task file's status can disagree with the directory it sits in
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-045
status: backlog
---

## Goal

`.tasks/` encodes a task's state **twice**: once in the directory it sits in, and
once in its `status:` frontmatter. Nothing checks that the two agree.

They drifted the day this was filed. `LAI-045` was accepted and moved to
`.tasks/done/` while its frontmatter still read `status: review` — CHIEF appended
an accept note and never touched the field, because the builder had already set
it correctly for the previous transition. One file in 126, found by grepping all
of them after a *different* protocol bug made the state of task files suspect.

That is the whole argument for the check. The board's central idiom is the drift
check — SPEC §4 ↔ `schema.ts` ↔ migrations ↔ database, SPEC §3 ↔ `can()`, server
views ↔ client types. Two encodings of the same fact, with nothing asserting they
match, is the same defect those exist to catch, sitting in the process the board
runs on rather than in the product.

## Acceptance criteria

- [ ] A test asserts that every file in `.tasks/<dir>/` carries
      `status: <dir>` — `backlog`, `in-progress`, `review`, `done`. It fails
      naming the file, the directory and the status it found.
- [ ] The directory list is **read from the filesystem**, not hand-written. A
      fifth state directory added tomorrow is covered without anyone remembering
      — the LAI-414 lesson, one task early.
- [ ] It also catches the fields that only make sense in some states: a file in
      `in-progress/`, `review/` or `done/` has a non-empty `assignee` and
      `started`; a file in `review/` or `done/` has a non-empty `finished`. Each
      failure names which field and which file.
- [ ] `.tasks/TEMPLATE.md` is exempt by name with its reason — it is the
      template, its frontmatter is a list of alternatives, and it is in no state
      directory. Any other exemption is listed with a reason and **self-expires**
      when that reason stops holding.
- [ ] **No two task files share an id.** Sweep every `.tasks/*/` file and fail
      naming both paths when an id appears twice. Three pairs exist today —
      `LAI-046`, `LAI-100`, `LAI-101` (LAI-131) — so this **will** be red on
      arrival: exempt exactly those three by name, with LAI-131 cited, and let
      the exemption **self-expire** if a pair is ever resolved. Any fourth
      collision must fail. Renumbering the existing three is forbidden (D-017).
- [ ] **Prove it can fail.** Flip one file's `status` to a state it is not in,
      confirm red naming that file, and revert. Put the message in your log.
- [ ] Passes on unmodified `master`. If it finds drift beyond the known one, that
      is a real finding — report it, do not fix task files in bulk to make the
      test green. `.tasks/` is CHIEF's; a discrepancy is CHIEF's to resolve.
- [ ] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.

## Notes

No new dependencies.

**This task authorises reading `.tasks/` from a test in your area** — it is a
named, auditable crossing (D-033/D-034): the test file is yours, the directory it
reads is CHIEF's, and it may only read. **It must never write to `.tasks/`, and
it must not be given an auto-fix.** A check that silently repairs the record it
is checking destroys the evidence that the process slipped.

The three existing `server/test/tooling/` checks are the shape to follow.
