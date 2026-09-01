---
id: LAI-445
title: The response-type census counts names, so it cannot see coverage through `extends`
area: server
assignee: core
priority: p3
depends-on: [LAI-444, LAI-160]
discovered-from: LAI-160
status: in-progress
started: 2026-09-01T21:35:00Z
---

## Goal

LAI-444's census lists **`ProjectView` as unpaired. It is not, and never was.**

`PAIRS` has `ProjectSummary → Project`; `ProjectSummary extends ProjectView`; and
`fieldsOf` **resolves `extends`** — so every `ProjectView` field has been compared
all along. **The census counts a literal name in `PAIRS` and cannot see coverage
inherited through a base type**, so its total overstates the gap by at least one.

Found by SHELL adding the pair the census asked for, which turned the drift check
**red correctly**: it asserted the base sends `task_counts`, `member_count`,
`blocked_count`, `members` and `last_activity_at` — the five the summary derives
and the base must **not** send.

## The second half, and it is the reason this is a task rather than a note

SHELL then tried to reclassify the row and **turned `names a client type that
exists` red** — because `UNPAIRED`'s second column *is* the client type, and
prose fails it. **There is no slot for "covered another way."**

That assertion is right and worth keeping: it is what stops a wrong guess sending
somebody hunting for an imaginary type. But it means the map has exactly two
states — *paired* and *unpaired-with-a-named-mirror* — and reality has a third.

**They left the row exactly as it was and explained why in the file**, rather
than routing around the assertion. Designing the third state is this task.

## Acceptance criteria

- [ ] The census resolves `extends` when deciding whether a served type is
      covered, **or** carries a third classification for *covered through a base
      type*, naming the pair that covers it.
- [ ] `ProjectView` stops being counted as unpaired **without** anybody adding a
      `PAIRS` entry for it — adding one is the thing that goes red, and correctly.
- [ ] `names a client type that exists` still fails on a genuinely wrong guess.
      **Do not weaken it to admit prose** — that assertion is the one keeping the
      list honest.
- [ ] Prove both directions: a type covered only through `extends` is not
      reported; a type covered by nothing still is.
- [ ] The count the census reports is the number of genuinely unguarded types.
      **Its total is read as a to-do list** — LAI-160's words — so it needs to be
      one.

## Notes / context

**Do not delete the `ProjectView` row by hand.** That fixes the number and leaves
the mechanism unable to see the next one, which is the same failure the census
was built to end.

**Nothing is unguarded today because of this.** It is a reporting defect, not a
coverage gap — which is why it is p3 rather than p2, and why it should not be
allowed to look urgent enough to be fixed the fast way.
