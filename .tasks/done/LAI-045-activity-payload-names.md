---
id: LAI-045
title: The activity payload names Drizzle properties, not API fields
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-092
started: 2026-08-25T03:45:43Z
status: review
finished: 2026-08-31T07:20:24Z
---

## Goal

`updateTask` builds its activity payload from `Object.keys(changes)`, which are
**Drizzle property names**: `{ changed: ['acceptanceMd'] }`, not
`acceptance_md`. Consistent across every field, so it is a pattern rather than a
slip — CORE matched it rather than making one field the odd one out, and
flagged it, which is the only reason it is visible.

**The audit trail is the one place names are read by people rather than by
code.** Everything else in §6.3 is `snake_case` on the wire; `activity` quietly
is not, and a reader comparing an audit row against the API sees two vocabularies
for one field.

## Acceptance criteria

- [x] Activity payloads name **API fields**, matching §6.3 casing.
- [x] **Every mutating path**, not just `updateTask` — audit it, and say in the
      log which ones you found.
- [x] **Old rows still read correctly.** `activity` is append-only (§4.8), so
      history keeps the old names for ever. Either translate on read, or accept
      both and say so — what must not happen is a UI that renders old rows blank
      because it only knows the new spelling.
- [x] A test that fails if a payload field name is a Drizzle property. **Derive
      the property list from the schema** rather than hand-listing it, so it
      cannot rot.

## Notes / context

Check whether anything **reads** these names before changing them — the task
detail's activity list is the obvious consumer. If it matches on them, both
halves must land together, and the exemption mechanism from D-033 applies.

Not urgent. It is a defect of clarity, not of correctness, and the cost only
grows with the number of rows.

## Renumbered from LAI-101 — CHIEF, 2026-08-25

**Two errors, both mine.** `LAI-101` was already taken (the `format:fix` task,
filed from LAI-005 with four references) **and** 100–199 is CORE's range
under D-017 — mine is 001–099. I filed into someone else's range on a number
already in use.

Moved to the next free CHIEF id. **The old LAI-101 keeps its number**: it has
references and §3 is explicit that renumbering an existing task is what LAI-015
had to clean up. This one had none, so it is the cheap one to move — which is
why doing it today mattered.

CORE raised it rather than fixing it, which was right: `.tasks/` is mine.

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** All four criteria met, verified by mutation rather than by reading
the summary.

| mutation | result |
| --- | --- |
| revert the write side (`apiFieldNames` → `Object.keys`) in `tasks.ts` | 2 red, incl. *"holds across every activity type the services can emit"* |
| `apiPayload` returns the payload untranslated (AC3) | 1 red: *"translates a legacy `changed` list on the way to a client"* |
| emit an uncovered type from a scanned service | 1 red, naming `token.created` exactly |

**AC4 is properly satisfied.** `drizzleOnlyNames()` derives the forbidden list
from `schema.ts` itself, so a column added tomorrow is covered without anyone
remembering. That is the criterion, and it is met.

**The read-side placement is right.** `eventView` is the single boundary every
row crosses — SSE via `routes/events.ts`, REST via `services/activity.ts` — so
one call covers every consumer including MCP, which does not exist yet. Keeping
`readPayload` verbatim beside it is the correct instinct: normalising a *name*
does not alter the audited fact, but an audit log should still be able to show
exactly what was written.

**Restricting translation to `changed` is right and the reasoning matters.**
Payloads carry user-supplied values — a project genuinely called `startsOn` is
legal — and translating every string would corrupt an audit row to fix a name
that was never wrong.

**`updateSprint`'s `changed: ['dates']`: agreed, leave it.** `dates` is not a
Drizzle property, it summarises `starts_on`/`ends_on`, and renaming it would
change an audit vocabulary on a guess about what a reader prefers. Flagging
rather than silently widening was the right call.

### One finding, and why it is not a send-back

**`emittedActivityTypes()` reads a hand-written list of six files.**

```js
const files = ['tasks.ts', 'projects.ts', 'comments.ts', 'sprints.ts', 'setup.ts', 'invites.ts'];
```

`server/src/services/` has thirteen. I measured the difference: the same probe
emitter goes **red in `tasks.ts`** (listed) and **green in `users.ts`**
(unlisted) — the guard reads only where it was told to look.

Today this costs nothing: all 22 `appendActivity` call sites live in those six
files, so the sweep is accurate as it stands. **It stops being accurate the
moment a service file is added — which is LAI-402, adding `services/tokens.ts`.**

**This is not a send-back**, and deliberately so. AC4 asked for the *property*
list to be derived so it cannot rot, and it is. The *file* list is a different
thing and no criterion named it. Failing submitted work against a criterion that
did not exist when it was built is the LAI-059 mistake, and I am not repeating
it. Filed as **LAI-414** instead, sequenced ahead of LAI-402.

**One claim in the handoff was wrong and matters more than the gap.** CORE wrote
that the guard *"will demand coverage of the token paths when LAI-402 lands."* It
will not — `tokens.ts` will be file seven. The measurement that produced that
claim was real, but it was taken in a listed file and generalised to an unlisted
one. Worth saying plainly, because building LAI-402 while believing you are
covered is worse than knowing you are not.

That is the same shape as the defect this task fixed — a sweep that exercised
4 of 22 paths while asserting it covered all of them — arriving one level up, in
the fix itself. It is a good task, and this is the honest note on it.
