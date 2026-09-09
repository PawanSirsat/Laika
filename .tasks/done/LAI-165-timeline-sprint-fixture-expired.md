---
id: LAI-165
title: 'The timeline sprint fixture pins absolute dates, so three tests expired on 2026-09-07'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-163
status: done
started: 2026-09-02T21:05:00Z
finished: 2026-09-02T21:15:00Z
---

## Goal

`server/web/test/browser/timeline-blocked-and-tabs.test.ts` fails three of its
six tests, on a clean tree, deterministically. **It is not flaky — it expired.**

```
not ok 1 - the active sprint is chosen on load
          'S4' !== 'S3'
not ok 3 - a future sprint counts to its start
          The input did not match /STARTS IN/. Input:
          'S4\nDONE 0/0\nBLOCKED 0\nWIP 0\nDAYS LEFT 12'
not ok 4 - being the current sprint is marked apart from being selected
```

Measured on `core` at 2026-09-09 with the working tree clean: `# pass 3`,
`# fail 3`.

## Cause

The fixture pins absolute dates and the assertions are about **date-relative UI
text**, so the tests are only true inside a window:

```ts
const d = (y, m, day) => Date.UTC(y, m, day);   // month is 0-indexed
S1  d(2026, 6, 13) – d(2026, 6, 26)   = 2026-07-13 → 07-26   completed
S3  d(2026, 7, 24) – d(2026, 8,  6)   = 2026-08-24 → 09-06   active
S4  d(2026, 8,  7) – d(2026, 8, 20)   = 2026-09-07 → 09-20   planned
```

The tests assert S3 is current and S4 is in the future. **That stopped being
true on 2026-09-07**, when S4 began. `DAYS LEFT 12` is S4 counting down to
09-20 — the number is right, the fixture is stale.

It will change shape again on **2026-09-21**, when no sprint contains today and
the failures become different ones. A reader who meets it then will not see the
same error as a reader meeting it now, which is what makes it worth fixing
rather than nudging.

## The comment that made it invisible

Line 25 reads:

```ts
/** Fixed dates, and `now` is pinned by the sprint that contains today. */
```

**Nothing pins `now`.** The fixture is fixed and the clock is real, so the
sentence describes the intent and reads as the mechanism. This is the shape
CLAUDE.md §5 names — a comment claiming more than the code under it does — and
here it is load-bearing: it is exactly the note that stops the next reader
asking "what happens when today moves?"

## Acceptance criteria

- [ ] The fixture's dates are relative to the run — computed from `Date.now()`,
      or the page's clock is pinned so `now` really is fixed. Either is fine;
      **the comment must describe whichever one is true.**
- [ ] Prove it does not expire: run the suite with the clock (or the fixture
      origin) set to a date before S1, inside each sprint, and after the last
      one. Green in every case, or explicitly out of scope with a reason.
- [ ] The three assertions still test what they were written for. `'S3'` was
      never the point — *"the sprint containing today is the one selected on
      load"* is, and a fixed name is how that got lost.
- [ ] Check the other browser fixtures for the same shape while you are here,
      and say in the task which ones you looked at. `board-presence.test.ts` and
      the dashboard tests also render date-relative text.
- [ ] Full gate `EXIT 0`.

## Notes

Found by CORE running the root gate for LAI-163. **Not fixed here** —
`server/web/` is SHELL's (D-031) and this is a real behavioural fixture, not a
named one-line crossing.

Filed p1 because it is red in the gate **now**, and a permanently red gate is
the thing that teaches people to stop reading it (the LAI-452 argument, arrived
at from the other direction: that one is red once in twenty runs, this one is
red every run).

---

## Closed as already fixed — CHIEF, 2026-09-02

**Correctly diagnosed, and already repaired before it was filed.** SHELL landed
the anchored fixture in **LAI-420**, which `master` carried before CORE reported
the red; CORE's own `Merge branch 'master' into core` has since brought it.

**Both of you found the same defect independently, hours apart, from opposite
directions** — SHELL from three assertions failing on the 7th, CORE from a red
root gate — and **both quoted the same misleading comment**:

> *"Fixed dates, and `now` is pinned by the sprint that contains today."*

**Nothing pins `now`.** That sentence is why nobody asked what happens when today
moves, and it is now the worked example in `docs/CONVENTIONS.md` §4's rule that
**a fixture may not be pinned to the calendar**.

**Nothing was wasted by the duplicate filing.** CORE's version carries the part
SHELL's did not: *"it changes shape again on 09-21 when no sprint contains
today"* — the observation that this fixture had **two** expiry dates, not one.
CLAUDE.md's rule stands: **duplicate filings are a cheap failure; lost
discoveries are not.**
