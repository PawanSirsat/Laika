---
id: LAI-445
title: The response-type census counts names, so it cannot see coverage through `extends`
area: server
assignee: core
priority: p3
depends-on: [LAI-444, LAI-160]
discovered-from: LAI-160
status: done
started: 2026-09-01T21:35:00Z
finished: 2026-09-01T21:55:00Z
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

- [x] The census resolves `extends` when deciding whether a served type is
      covered, **or** carries a third classification for *covered through a base
      type*, naming the pair that covers it.
- [x] `ProjectView` stops being counted as unpaired **without** anybody adding a
      `PAIRS` entry for it — adding one is the thing that goes red, and correctly.
- [x] `names a client type that exists` still fails on a genuinely wrong guess.
      **Do not weaken it to admit prose** — that assertion is the one keeping the
      list honest.
- [x] Prove both directions: a type covered only through `extends` is not
      reported; a type covered by nothing still is.
- [x] The count the census reports is the number of genuinely unguarded types.
      **Its total is read as a to-do list** — LAI-160's words — so it needs to be
      one.

## Notes / context

**Do not delete the `ProjectView` row by hand.** That fixes the number and leaves
the mechanism unable to see the next one, which is the same failure the census
was built to end.

**Nothing is unguarded today because of this.** It is a reporting defect, not a
coverage gap — which is why it is p3 rather than p2, and why it should not be
allowed to look urgent enough to be fixed the fast way.

## Outcome

**Resolved `extends`, rather than adding a third classification.**

Both were offered by AC1, and the task file made the argument for this one
without meaning to: *"a classification somebody has to notice and write down"*
covers the case in front of them. `coveredByExtends` covers the next one too —
and there will be one, because `extends` is how this codebase derives a served
shape from a base.

Transitive, because `A extends B extends C` compares C's fields just as surely as
B's, and a two-level chain is not a different situation from a one-level one.

**`ProjectView` leaves `UNPAIRED` because the census can now see the coverage**,
not because anybody decided it was fine. That is AC2's distinction and the whole
point of not deleting the row by hand.

### The assertion that stays untouched

`names a client type that exists` is unchanged, and that is deliberate: **the row
left the map rather than gaining prose**, so there was never a reason to weaken
it. Mutating an entry's value to `'covered another way'` still fails it —
verified, not assumed.

That assertion is the one keeping the list honest, and SHELL's finding was
exactly right: it has two states and reality had three. The fix is that the third
state is not in the map at all.

### Both directions (AC4)

- `ProjectView` **is** covered — `ProjectSummary` is paired and extends it.
- `CapacityView` is **not** — nothing extends into it, and it stays exempted.
- And a blunt guard that `coveredByExtends` cannot claim everything: nothing in
  `UNPAIRED` may also be reported as covered, and the covered set must be smaller
  than the served set. Without it, a resolver returning everything would satisfy
  the first bullet and empty the census of meaning.

| mutation | result |
| --- | --- |
| `coveredByExtends` returns every served type | red — 3 tests |
| stop resolving `extends` at all | red — 3 tests |
| a `UNPAIRED` value becomes prose | red — `names a client type that exists` |

### The count is now a to-do list (AC5)

`paired + inherited + unpaired === served`, asserted. LAI-160's words — *"its
total is read as a to-do list"* — so it has to be one, and the three-way split is
what makes the arithmetic check anything.

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` **1818/1818**,
`web` 604/604, `cli` 49/49, lint and format EXIT=0.

### One thing on my branch that is not this task

`orgs.ai_key_last4` is still in `COLUMNS_NOT_IN_SPEC` — LAI-447's in-flight
entry. **I have not dropped it because §4.2's row is not in any commit on any
branch**: `git log --all -S "ai_key_last4" -- docs/SPEC.md` is empty, and
`09326b1` — whose message names it — changed no file under `docs/`. The exemption
is therefore not stale, `schema-spec-drift` is green with it, and dropping it
would make the gate red. Raised separately; it is not LAI-445's to resolve.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — 1831 server.

**Resolving `extends` rather than adding a third column**, for the reason the
task gave and you quoted back: *"a classification somebody has to notice covers
the case in front of them; this covers the next one too."* **And transitive** —
*"`A extends B extends C` compares C's fields just as surely as B's"* — which is
what makes it a fix rather than a patch.

**`names a client type that exists` is untouched**, and `ProjectView` **left** the
map rather than gaining prose. Mutating a row to `'covered another way'` still
fails it. **The assertion that made the third state necessary is the one that
survived the third state**, which is the right outcome.

**Both directions asserted, plus the blunt guard** that `coveredByExtends` cannot
claim everything — two mutations, red on three tests each.

### The negative example was the one thing that had to change

`CapacityView` stopped being unpaired between your writing it and its landing,
because SHELL built the screen. **A negative example that names a real unpaired
type is a fixture that decays the moment somebody does the work the census exists
to prompt** — the fixture rule pointed the other way: not *built so the property
cannot be violated*, but **built so it expires when the codebase improves.**

Synthetic names are right, and `ProjectView` staying as the **positive** case is
right too: that one is the real thing the task exists for.
