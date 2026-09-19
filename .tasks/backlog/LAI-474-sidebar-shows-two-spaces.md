---
id: LAI-474
title: 'The sidebar shows two spaces, not three'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

**Owner-reported, with a screenshot:** *"here only show 2 projects not three in
sidebar other in more spaces"*. The sidebar draws `laika-core`, `laika-web` and
`laika-infra`; it should draw two, with the rest reachable through *More
spaces*.

**This amends D-059.1**, which said three. **D-061 records the change** — read it
before starting, particularly the paragraph on what this must not be read as
reopening.

## What this is

`server/web/src/routes/spaces.ts` — **`RECENT_LIMIT = 3 → 2`**. Both the display
slice (`recentSpaces`) and the storage cap (`promote`) already read the
constant, so the behaviour follows from one value.

**The work is the tests, not the constant.** Several assert the old number, some
through `RECENT_LIMIT` and some as a literal `3`, and the literals are the ones
that matter: a test that hardcodes the number is asserting the *old* design and
must be re-aimed deliberately, not loosened until green.

## Acceptance criteria

- [ ] **The sidebar draws exactly two space rows**, then *More spaces*. Asserted
      in the browser test by counting `.space-row`, not by reading the constant
      back.
- [ ] **The space you are in is always one of the two.** Open a space from the
      *More spaces* popover and it appears in the sidebar immediately — a
      selected space that stays invisible is worse than a third row.
- [ ] **Every project is still reachable**, and *More spaces* still lists the
      whole directory including the two on display (D-061). It stays
      unconditional.
- [ ] **Clicking a space still moves nothing** — LAI-260's property, re-asserted
      at two slots. Read the rendered order before and after a click and compare.
      **Do not weaken this**; fewer rows makes it matter more.
- [ ] **`promote()` caps stored recency at the new limit**, and **a
      `localStorage` list left over from the three-slot build is handled** rather
      than trusted — `spaces.test.ts` already calls storage untrusted input and
      has the case; it needs to still mean something at two.
- [ ] **Each test that hardcoded `3` is re-aimed, not deleted.** Named, because a
      criterion that says "update the tests" is unreviewable:
      - `server/web/test/routes/spaces.test.ts:157` — `assert.equal(shown.length, 3)`
      - `server/web/test/routes/spaces.test.ts:206` — *"the remembered three are
        the three shown"*, whose `deepEqual` lists three slugs
      - `server/web/test/browser/spaces-sidebar.test.ts:320` — the reload test,
        whose comment reasons from *"four projects and three slots"*
      **That last one's purpose must survive the edit.** It distinguishes
      storage being read back from the fill-up loop refilling by chance; with
      four projects and two slots it still can, but only if the expected set is
      chosen to tell those apart. Re-derive it rather than deleting a slug.
- [ ] Prose that says "three" in `spaces.ts`, `use-spaces.ts` and the test files
      is corrected. **A comment claiming more than the code does is the defect
      CLAUDE.md §5 names** — and here it would describe a design that no longer
      exists.
- [ ] Both themes, and the sidebar's geometry still matches the design at two
      rows — the section is shorter now and must not leave a gap where the third
      row was.
- [ ] Full gate — repo root, all three `EXIT 0`, each captured on its own line.

## Notes / context

**SPEC §11.4.2.1's sidebar row already says two.** CHIEF edited it with D-061;
you do not need it and must not touch `docs/`. **Nothing binds that row to the
constant** — no drift test parses §11.4 prose — so this is not a §4.4 two-owner
change and your half is green or red on its own.

**Do not make `More spaces` conditional.** With exactly two projects it would
vanish, and the popover is the directory rather than the leftovers (D-061).

**Do not add pinning.** If the churn of a two-slot list turns out to grate, that
is the answer and it is a separate decision — D-061 says so explicitly so that
nobody reaches for it here.

**No new dependencies, no new tokens.**

**This is a new task rather than a note on one in review.** `LAI-248` built the
sidebar and `LAI-260` fixed its ordering; both are in `.tasks/review/` and their
criteria are frozen (CLAUDE.md §2). Neither failed — the owner has changed what
is wanted since.
