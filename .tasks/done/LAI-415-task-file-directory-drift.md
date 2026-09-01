---
id: LAI-415
title: A task file's status can disagree with the directory it sits in
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-045
status: done
started: 2026-09-01T15:15:00Z
finished: 2026-09-01T15:50:00Z
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

- [x] A test asserts that every file in `.tasks/<dir>/` carries
      `status: <dir>` — `backlog`, `in-progress`, `review`, `done`. It fails
      naming the file, the directory and the status it found.
- [x] The directory list is **read from the filesystem**, not hand-written. A
      fifth state directory added tomorrow is covered without anyone remembering
      — the LAI-414 lesson, one task early.
- [x] It also catches the fields that only make sense in some states: a file in
      `in-progress/`, `review/` or `done/` has a non-empty `assignee` and
      `started`; a file in `review/` or `done/` has a non-empty `finished`. Each
      failure names which field and which file.
- [x] `.tasks/TEMPLATE.md` is exempt by name with its reason — it is the
      template, its frontmatter is a list of alternatives, and it is in no state
      directory. Any other exemption is listed with a reason and **self-expires**
      when that reason stops holding.
- [x] **No two task files share an id.** Sweep every `.tasks/*/` file and fail
      naming both paths when an id appears twice. Three pairs exist today —
      `LAI-046`, `LAI-100`, `LAI-101` (LAI-131) — so this **will** be red on
      arrival: exempt exactly those three by name, with LAI-131 cited, and let
      the exemption **self-expire** if a pair is ever resolved. Any fourth
      collision must fail. Renumbering the existing three is forbidden (D-017).
- [x] **Prove it can fail.** Flip one file's `status` to a state it is not in,
      confirm red naming that file, and revert. Put the message in your log.
- [x] Passes on unmodified `master`. If it finds drift beyond the known one, that
      is a real finding — report it, do not fix task files in bulk to make the
      test green. `.tasks/` is CHIEF's; a discrepancy is CHIEF's to resolve.
- [x] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.

## Notes

No new dependencies.

**This task authorises reading `.tasks/` from a test in your area** — it is a
named, auditable crossing (D-033/D-034): the test file is yours, the directory it
reads is CHIEF's, and it may only read. **It must never write to `.tasks/`, and
it must not be given an auto-fix.** A check that silently repairs the record it
is checking destroys the evidence that the process slipped.

The three existing `server/test/tooling/` checks are the shape to follow.

## Outcome

`server/test/tooling/task-file-state.test.ts` — eleven assertions over all 236
task files. It **reads `.tasks/` and never writes it**, and has no auto-fix.

### Proof it can fail (AC6)

Flipped `status: review` → `done` on a file of mine in `review/`:

```
× carries status: <the directory it is in>
+   ".tasks/review/LAI-443-session-refused-log-is-unasserted.md is in review/ but says status: done",
```

The file, the directory and the status found, as AC1 asks. Reverted; `git status`
clean afterwards. Re-run after a later retyping rather than assumed to still hold.

### Four findings, reported and not fixed (AC7)

These are CHIEF's files. Each is exempted **by name with its reason**, and each
exemption **self-expires** — fix the file and the entry becomes stale, which
fails.

**1. `.tasks/backlog/LAI-130-spec-task-acceptance-field.md` says `status: done`
while sitting in `backlog/`.** The one to look at first. Whichever way it
happened — accepted then moved back, or reopened without resetting the field —
the two records disagree about whether the work is finished, and the directory is
what the protocol treats as authoritative.

**2. `.tasks/done/LAI-118-activity-triggers-survive-rebuilds.md` says
`status: review`.** The LAI-045 shape exactly: accepted, note appended, field
left behind.

**3. `.tasks/done/LAI-057-guard-shutdown-wiring.md` has no frontmatter block at
all.** Not a missing field — an absent header, which is why it is also the only
file with no `id` and no `status`. It needs a header, not a value, so it is
exempted separately from the field list.

**4. `LAI-153` is in `done/` and `review/` at the same time.** The *same* task,
both copies. This is the two-copy state §2 describes, where an accept and a
builder's submission both landed, and one of the two is stale. **Not historical
and not the same as LAI-131's pairs** — it happened this week. Exempted so the
rest can be green, not because it is acceptable.

**And one the task file got wrong, found by the mechanism it asked for.** AC5
names `LAI-101` as a third historical collision to exempt. **It no longer
collides.** Had I taken the list on trust and written it in, the staleness guard
would have failed with *"LAI-101 no longer collides — remove it from
KNOWN_COLLISIONS"*. That is the exemption style paying for itself on its first
use, against the task that specified it.

### Twenty-five files predate a required field

All in `done/`. **None in `in-progress/` or `review/`** — every live file is
complete, so this is an archive written under earlier versions of the protocol,
not a process currently slipping.

Exempted **by name rather than by leaving `done/` unchecked**, which is the
choice worth defending: a 25-name list looks worse and is better, because a
*new* omission fails immediately and each entry dies when CHIEF fills the field
in. Narrowing the check to live states would have been three lines and would have
silently dropped AC3's `done`.

Thirteen lack `assignee`, twenty-three `started`, twenty-five `finished`. Four are
recent rather than ancient — `LAI-209`, `LAI-210`, `LAI-212`, `LAI-217`, all
SHELL's — which is worth a look, since those postdate the fields being routine.

### Self-expiry, proven in both directions

Not asserted — mutated, each confirmed to have landed:

| mutation | result |
| --- | --- |
| exempt a collision that no longer exists (`LAI-101`) | red: *"LAI-101 no longer collides — remove it from KNOWN_COLLISIONS"* |
| exempt a field a file already has | red: *"…LAI-045-activity-payload-names.md now has assignee — remove it from PREDATES_THE_FIELD"* |
| drop a real collision from the exemption | red: *"LAI-153 appears in .tasks/done/… and .tasks/review/…"* |

The second mutation initially hit the *file does not exist* branch instead of the
one I meant; I re-ran it against a real file so the branch I claimed to be testing
is the branch that ran.

### Two things I built differently from the criteria

**`README.md` as well as `TEMPLATE.md`.** AC4 names the template; `.tasks/` also
holds a `README.md`. Neither is in a state directory, so neither is ever
collected — the exemption is structural rather than by name, and the constant
says so.

**`.gitkeep` is skipped in the stray-file check.** It keeps an empty state
directory in git and is not a task. My first version flagged four of them, which
is the check being wrong rather than the repo.

### Gate

`@laika/server` **1730/1730**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0, typecheck clean. `server/web` red on LAI-208's declared assertion only.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — 1740 server, 594 web, 49 cli.

**Mutation-verified:** making `closedUnbuilt` return `false` turns three tests
red across **four** files, so the branch is load-bearing rather than decorative.

**My first two mutations of this task did not land**, and both printed a green
suite beneath them — the exact trap you had just described. Fourth time today for
me.

### Deleting the two exemption lists rather than emptying them

> *"An emptied exemption list is scaffolding that invites re-exemption over a
> fix."*

**That is the right call and it is not obvious.** An empty list looks harmless
and is an invitation; the check now simply demands agreement, and the failure
message says what to do. **Every one of the four went stale and named itself**,
which is the whole return on the style.

### The `- 1`, and what you replaced it with

I said it encoded a contingent fact. **You made it better than correct:**
`expect(parsed.map(f => f.path)).toEqual(files.map(f => f.path))` **names the
offender** instead of reporting a count — so the next unparseable file fails with
its own path rather than with `expected 236 to be 235`.

### Teaching it the third state, and refusing my alternative

I offered "exempt the three by name" as an equal option. **You ruled it out and
the reason is better than my offer:**

> *"Exempting LAI-209/210/212 by name would have recorded something **false**
> about them in a list titled 'predates the field' — they are not archive and
> nothing is missing. **The list would have been the lie, not the file.**"*

That is the inventing-timestamps argument applied one step earlier, and I did not
see that it applied there. **Twenty entries, down from twenty-five**, because
LAI-145 already carried `closed:` — a fifth file the rule was right about before
anybody looked.

### And the exemption style caught the task that specified it

AC5 named `LAI-101` as a third historical collision to exempt; **it no longer
collides**, and writing it in on trust would have failed with *"LAI-101 no longer
collides"*. **The claim and the instrument that disproves it in one paragraph**,
and the claim was mine.
