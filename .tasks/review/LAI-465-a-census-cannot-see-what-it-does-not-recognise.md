---
id: LAI-465
title: 'Three guards this week decided their own reach and none reported it'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-454
status: review
started: 2026-09-09T22:20:00Z
finished: 2026-09-09T23:00:00Z
---

## Goal

**One defect, three instances, all found within a day of each other:**

| guard | what decided its reach | what it missed | found by |
| --- | --- | --- | --- |
| `schema-spec-drift` nullability | a bespoke regex requiring **one** backticked name per row | **five columns** in multi-name rows | LAI-163, mid-task |
| `response-type-coverage` census | a `...View` suffix **or** a `c.json<T>` annotation | two of three new response types | LAI-454, mid-task |
| the endpoint sweep (LAI-460) | *not yet built* | — | **filed against this exact shape** |

**Each one under-reported in silence and looked green.** The reach was decided by
something nobody was re-checking, and — the part that makes it a class rather
than three bugs — **in every case the guard could not tell *"nothing here"* from
*"nothing I recognise."***

`response-type-coverage` is the live one: `MeetingReviewSummary` and
`MeetingReviewDetail` were invisible to it. **`ProposalView` was counted purely
because of what it was called.** CORE renamed all three to the convention rather
than exempting them, so the count is right today — **and nothing stops the next
one being named differently.**

## Acceptance criteria

- [x] **Every guard that discovers its own inputs reports what it found**, not
      only what it objected to. A census that prints *"14 served types checked"*
      is falsifiable by a reader; one that prints nothing is not.
- [x] **`response-type-coverage` fails when its discovery finds nothing**, the
      way `finds task files at all` and `finds the statements it claims to check`
      already do. An empty input set must be a failure, never a pass.
- [x] **Name the discovery rule in the file, next to the discovery.**
      *"A served response type is one whose name ends `View` or that appears in a
      `c.json<T>`"* is a **convention the codebase must follow**, and it is
      currently enforced by nothing. Either assert it, or say plainly in the
      comment that it is a heuristic and what escapes it.
- [x] **Sweep for a fourth.** Any guard in `server/test/tooling/` that builds its
      own input list — by suffix, by regex, by directory walk — gets the same
      question asked of it. **Report what you find, including "nothing else."**
- [x] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**This is not a request to make the guards stricter.** A heuristic reach is often
the right one — LAI-163 argued convincingly that inferring nullability from
silence would fail on most of the schema, and that argument still holds. **The
defect is the silence about the reach, not the reach.**

**CORE named this rather than filing it**, on the grounds that it was the third
instance of one pattern in a day and the pattern deserved treating over the
instance. **They were right, and this is that task.**

---

## Submission note — CORE, 2026-09-09

**Root gate `EXIT 0`** — server 1915, `server/web` and `cli` zero failures.

### AC1 — six guards report, in the gate's own output

```
[discovery] structure: srcFiles=146 srcModules=98 webSrcFiles=147
[discovery] response-type census: served=32 paired=22 unpaired=9
[discovery] task files: files=270 stateDirs=4
[discovery] §3 matrices: orgRows=14 projectRows=16 proseRules=2
[discovery] activity emitters: sourceFiles=98 emittedTypes=32 drizzleOnlyNames=73
[discovery] §4 nullability: stated=41 declared=191 notNull=1
```

**A floor cannot do this job.** It catches a discovery that collapses to zero; it
cannot catch the partial miss, which is what happened all three times — 24
statements instead of 29, one response type instead of three, nothing zero,
nothing failing. Only a reader seeing the number catches that.

**`process.stdout.write`, not `console.log`.** Vitest intercepts `console.*` and
the **default reporter — the one this gate runs — does not print it on a passing
test.** I had it working under `--reporter=verbose` first and nearly stopped
there. A report only a flag can see is a report nobody reads.

### AC4 — the fourth instance, and it is the quietest

**`structure.test.ts`.** Stubbing `walk()` to return `[]` left **16 of 19 tests
green**. The three that failed did so *incidentally*: they check that exemption
entries name files that exist, so they failed because the **files** vanished, not
because the scan did. **Empty those lists and the file asserts nothing at all.**
It now fails on the walk.

Swept all 13 files in `test/tooling/`. Ten discover their own inputs; nine had a
floor, `structure` did not. `format-fix`, `toolchain` and `environment-posture`
discover nothing of their own — reporting that, so nobody re-runs the sweep.

### AC3 — a served type of mine was invisible, and it is named now

**`ApplyReviewResult`**, returned by `POST /meeting-reviews/:id/apply` through a
bare `c.json(result)`. Written in LAI-451 — **two tasks after I renamed three
other types for this exact reason** — and the census said nothing. Annotated.
**The moment it became visible the census demanded it be paired or exempted**,
which is the guard working the instant it could see.

The docblock no longer claims the `*View` convention *"is followed"*. It states
the reach as **two spellings plus a ruled-on list of near-misses**, and says what
still escapes: a served type called `Thing` escapes all of it.

`NOT_SERVED` closes the near-miss half — nine entries, each with a reason, each
checked to still exist. A new `…Summary` or `…Result` fails until somebody rules
on it.

### Probes, five, all red

Census discovery emptied; `structure`'s walk emptied; the `c.json<T>` reverted to
bare; task-file walk emptied; §3 matrix rows emptied. Each file checksummed back.

### Two numbers now visible that were not

- **`stated=41`**, up from 30 this morning — LAI-463's §4 rows widened the reach
  with **no change to my file**. Your reframing, proved a third time, now visible
  every run.
- **`emittedTypes=32` against 37 in `ACTIVITY_TYPES`.** Five declared verbs are
  emitted by nothing this sweep reaches. **Not investigated** — it may be
  legitimate — but it is precisely the kind of number that was invisible an hour
  ago. Worth a look by somebody; say if you want it filed.
