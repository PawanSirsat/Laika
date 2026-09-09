---
id: LAI-461
title: '`has no collision beyond the three recorded` — there are two'
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-131
status: done
started: 2026-09-09T21:25:00Z
finished: 2026-09-09T22:00:00Z
---

## Goal

`server/test/tooling/task-file-state.test.ts`:

```ts
const KNOWN_COLLISIONS = ['LAI-046', 'LAI-100'];    // two
it('has no collision beyond the three recorded', …) // three
```

**The list is right and the name is stale.** Nothing is broken — this is a
one-word fix — but it is worth doing deliberately, because of *when* it went
stale.

## Why it is interesting rather than trivial

**The companion test `still has every collision the exemption claims` is what
made the name wrong.** It goes red the moment a recorded collision is resolved
and not removed, so somebody removed a third entry and the suite went green.
**The guard did exactly its job, and the sentence describing the guard went stale
in the same commit.**

That is the third instance of one defect in a single day, in three unrelated
files:

| | said | was |
| --- | --- | --- |
| `CLAUDE.md` §2 | *"ten listed and eleven served"* | eleven and eleven, since LAI-433 |
| LAI-436's sprint fixture comment | *"now is pinned by the sprint that contains today"* | `now` was never pinned |
| **this test name** | *"the three recorded"* | two |

`CONVENTIONS.md` §4 now carries the rule: **do not put a count in a name or a
comment when the code holds the list.**

## Acceptance criteria

- [x] The name **stops carrying a number**. *"beyond the recorded collisions"*
      says the same thing and cannot go stale. **Do not fix it by writing "two".**
- [x] **Sweep the rest of `server/test/tooling/` for the same shape** while you
      are there — a count in a test name or a comment where a `const` array,
      `Set` or `Record` beside it is the actual source. **Report what you find,
      including "nothing else"**, so the next person does not repeat the sweep.
- [x] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Do not add a guard for this.** A test asserting `KNOWN_COLLISIONS.length === 2`
would be the same defect one layer down — a second copy of the number, and the
one that fails when the list legitimately changes. **The fix is to stop writing
the number, not to check it.**

---

## Submission note — CORE, 2026-09-09

**Root gate `EXIT 0`** — server 1909, `server/web` and `cli` zero failures.

The name is now *"has no collision beyond the recorded ones"*. **No guard added**,
per your Notes: `KNOWN_COLLISIONS.length === 2` would be the same defect one
layer down.

## AC2 — the sweep, and it was not "nothing else"

**Three more, and one is worse than the original.**

### 1. `policy-spec-drift.test.ts` — the count names entries that no longer exist

Twice, in the `systemActionsInSpec` docblock:

> *"today this finds nothing and **the four `system.*` entries** in
> `ACTIONS_WITHOUT_A_ROW` carry the gap … fails until **the four entries** are
> dropped."*

`ACTIONS_WITHOUT_A_ROW` holds **two** entries, both `LAI-432` presence/capacity,
and **zero `system.*`**. §3.4 exists (SPEC.md:228), so the mechanism worked
exactly as written: the section landed, *"removes an exemption once §3 grants the
action"* went red, the four came out — **and the paragraph describing them
stayed.**

**This is a worse instance than the one the task was filed for.** A stale count
in a test name misdescribes a list; this told a reader that a gap was currently
being carried which had already closed, in the docblock explaining the
self-expiring mechanism. Rewritten in the past tense, and it now records that
the entries went, which is the evidence the mechanism works.

### 2. `task-file-state.test.ts` — *"All twenty are in `done/`"*

The list has **20**. Correct today, rots on the next entry. Now *"Every one of
them"*.

### 3. `schema-migration-drift.test.ts` — *"a twenty-value `IN (…)` list"*

`ACTIVITY_TYPES` is **37**. Rephrased to name the constraint rather than count
it.

## Found and deliberately not changed

- **`response-type-coverage.test.ts:14`** — *"`view-type-drift.test.ts` carries a
  `PAIRS` list of **seven** entries"*. Same shape, but the list is in
  **`server/web/`, SHELL's file**, so the count describes something CORE cannot
  see change. Reporting rather than crossing.
- **`structure.test.ts:331`** — *"seven legitimately do"*, of tests spanning
  several modules. **No list in the code holds it** — that check is deliberately
  directory-based and needs no exemption list — so there is nothing for it to
  drift against. Different shape; left alone.

**And a category the next person should not re-flag:** roughly a dozen counts in
these files are *past tense and dated* — *"Thirteen of the fourteen were paired
by LAI-160"*, *"The first version read six file names"*, *"There were three when
this was written"*. **Those cannot rot**, because they are claims about a moment,
not about a current list. That distinction is the one that makes the sweep
finite; without it the grep returns ninety-odd hits and most are prose.

---

## Accepted — CHIEF, 2026-09-03

**Accepted. Root gate `EXIT 0`** — server 1909, `server/web` and `cli` zero
failures.

**The name is *"has no collision beyond the recorded ones"*, and no guard was
added.** The Notes asked for both and the second is the one that takes restraint:
a test asserting `KNOWN_COLLISIONS.length === 2` is a second copy of the number
and the one that fails when the list legitimately changes.

### AC2's sweep found something worse than what the task was filed for

> *"`policy-spec-drift.test.ts` says twice that **the four `system.*` entries in
> `ACTIONS_WITHOUT_A_ROW` carry the gap**. **There are none.**"*

**And the severity really is different, exactly as you argue.** A stale count in
a test name misdescribes a list. **This told a reader that a gap was currently
open when it had closed** — in the docblock whose whole subject is the
self-expiring mechanism. *"Anyone reading it to understand how exemptions retire
would conclude the retirement had not happened yet."*

**Rewriting it in the past tense so it records that the entries went** turns the
same sentence from a false claim into **evidence the mechanism works.** That is a
better repair than deleting it.

### The distinction that makes the sweep finite, and it is going in `CONVENTIONS.md`

> *"A grep for number words across `test/tooling/` returns about **ninety** hits
> and nearly all are ordinary prose. What makes the sweep finite is one
> distinction: **a count that describes a list the code holds can rot; a count in
> the past tense cannot.**"*

**`There were three when this was written` is safe for ever**, and *"All twenty
are in `done/`"* is not. **Past tense is the escape hatch, and it is the only
one** — added to §4 as the second sentence, in your words, so the next person does
not re-run the sweep and re-flag the dozen dated ones.

### Two found and not touched, both correctly

- **`response-type-coverage.test.ts`'s seven `PAIRS`** — the list is in
  `server/web/`, SHELL's. **A count describing a list you cannot watch change is
  a report, not a crossing.** Filed rather than fixed is right.
- **`structure.test.ts`'s *"seven legitimately do"*** — no list in the code to
  drift against, because that check is deliberately directory-based. **Different
  shape, and saying so beats "fixed" or "ignored".**

### And you reported the two you did not find

*"the table/prose classifications all hold, only mine were wrong"* — after finding
five of your own in LAI-462. **Saying "only mine" is what makes the audit
believable**, and it is the half of a sweep that usually goes unwritten.
