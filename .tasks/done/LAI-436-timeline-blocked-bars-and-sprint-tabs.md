---
id: LAI-436
title: A blocked task's bar is not red, and there is no sprint tab row
area: web
assignee: shell
priority: p2
depends-on: [LAI-434]
discovered-from: LAI-434
started: 2026-09-01T16:55:00+05:30
finished: 2026-09-01T18:05:00+05:30
status: done
---

## Goal

Two gaps between the timeline and the design, found by **looking at the running
screen** after LAI-434 landed. **Both are CHIEF's fault, not the builder's** —
each was written as prose in LAI-434 and never turned into a numbered criterion,
so LAI-434's ticks are all honest.

### 1. A blocked task's bar has no colour

LAI-434's prose said *"the bar, coloured by status, **red with a blocked
marker** when `blocked_by` contains an unfinished blocker"*. Its numbered
criterion said only that the marker uses `board-derive.ts`'s computation — which
it does, **for the summary count**. So the strip reads `BLOCKED 1` and **no row
shows which one.**

The prototype colours the bar red and puts a lock on it. That is the point of
the row: a person scanning the timeline should see *which* work is stuck without
reading a number and then hunting.

### 2. No sprint tab row

The prototype has tabs across the top — `S1 … S4`, each with a progress bar and
`11/11`-style counts — and clicking one selects that sprint's summary strip.

**The counts are already in a better place** (`7/7`, `0/9`, `0/4` in the band
headers), so this is about **selection**, not information: today the strip always
shows the active sprint and there is no way to look at a finished or a future one.

## Acceptance criteria

- [x] A task whose `blocked_by` contains an unfinished blocker renders **red**,
      **outlined or solid alike** — blocked is orthogonal to measured-versus-placed,
      and a blocked task that has started must not lose its solid fill to say so.
- [x] The blocked treatment is **not colour alone** — same rule as
      solid-versus-outline (LAI-434), for the same reason. A marker, a pattern,
      or a glyph.
- [x] `blockedState` from `board-derive.ts`, not a second computation.
- [x] A tab row lists every sprint with its `done/total`, and **selecting one
      shows that sprint's summary strip** — `DONE / BLOCKED / WIP / DAYS LEFT`
      computed for the selected sprint, not only the active one.
- [x] **`DAYS LEFT` for a completed sprint is not a negative number**, and for a
      planned one it is not "days left" at all. Decide what each says and test
      both — this is where the clamp from LAI-434 stops being sufficient.
- [x] The active sprint is selected on load, and is visually distinguishable from
      a merely selected one.
- [x] A browser test in both themes: a blocked row is identifiable without
      reading the strip, and selecting a completed sprint changes the strip.
- [x] Full gate green — repo-root `pnpm test`.

## Notes / context

**No new endpoint.** Everything is already on the tasks and sprints responses.

**Do not add a fourth `initials()` or a second blocked rule** — LAI-215 and
LAI-434 both landed on reuse and this is the third chance to get it wrong.

**The lesson this task exists to record**, since it cost a round trip: *intent
written as prose in a task file reads as binding and measures nothing.* If a
sentence describes something the screen must do, it belongs under **Acceptance
criteria**, or it will be built to the criterion and not to the sentence — and
the builder will be right.


---

## Submitted — SHELL, 2026-09-01

Root gate `EXIT 0` — 1719 server, **604** web, 49 cli, zero
`Unhandled|Errors|Failed|not ok`. Six mutations, all red.

### 1. The blocked bar — the defect was two classes rendering identically

Measured before touching it. A blocked task that had never started computed
**byte-for-byte the same** as an unblocked one, in both themes:

```
.tl-bar-planned.tl-bar-todo               bg rgba(0,0,0,0)  border rgba(255,255,255,0.2)
.tl-bar-planned.tl-bar-todo.tl-bar-blocked bg rgba(0,0,0,0)  border rgba(255,255,255,0.2)
```

`.tl-bar-planned.tl-bar-blocked` set the fill transparent to keep the outline and
inherited the grey border with it. **Any test on class names would have passed
throughout**, which is why the browser test compares the blocked bar's computed
colour against the unblocked one beside it rather than against a constant.

Blocked now colours the **border** on an outline and the **fill** on a solid bar,
so it survives being planned without costing a started task its fill. The dot was
`var(--card)` on a transparent bar — a card-coloured dot on the card — and is now
red with a card ring, inverted on a red fill.

### 2. The tabs

Every sprint, with `done/total`, a progress meter and a lock badge when blocked;
real `button`s with `aria-pressed`. Selecting one recomputes the whole strip.
**Selection is a background, being current is a glyph** — so they stay
distinguishable when they coincide, which by default they do.

### 3. `DAYS LEFT` — and a disagreement it uncovered

`daysLeft` became `countdown`, a discriminated `left | starts_in | ended`:
`DAYS LEFT 6` · `ENDED 37d ago` · `STARTS IN 6d`. A clamp turns a wrong number
into a misleading one, and `DAYS LEFT 0` cannot be told from a sprint ending
tonight.

**Reusing `sprint-derive`'s `daysLeft` instead of counting again exposed a live
inconsistency: the board and the timeline were showing different numbers for the
same sprint on the same day.**

| | last day of a sprint |
| --- | --- |
| `sprint-derive.daysLeft` — the board's strip | **1** |
| `timeline-derive.sprintSummary` — this screen | **0** |

The timeline's test justified `0` with *"`ends_on` is inclusive (§4.15): on the
final day there is no day left after today"*. **§4.15 says only that the dates
are date-only** — it does not decide this — and the conclusion contradicts its
own premise: if the end day is included, it is a day left. `sprint-derive` has
always said `1`, with the better reason: *"the day you are standing in is still a
day you can work."* That one wins, `countdownFor` calls it, and **the assertion
that said `0` now says `1`** with the flip written down as the finding.

### Named widenings, for you to reverse if you disagree

- **`src/components/LockIcon.tsx` is new.** The padlock was already pasted in
  `ProjectStats` and `TaskCard`; the Notes call a third *"the third chance to get
  it wrong"*, so I extracted it rather than adding one. `ProjectStats` now uses
  it — byte-identical.
- **`TaskCard` was left alone**, deliberately: its copy is `strokeWidth="2"`
  against this one's `2.2`, so converting it changes a glyph on the *board* in a
  *timeline* task. One line whenever you want it.
- **`LoginScreen`'s padlock stays** — it labels a password field. Same drawing,
  different sentence.

### Found by running it, not by reading it

`useState` for the selection read better beside the code that used it, and that
is a **Rules of Hooks violation** — this component returns early for loading,
error and an empty range. React said `Minified React error #310` and rendered a
blank screen. **Typecheck and every unit test passed**, because none of them
mounts the component. Moved above the early returns, with the reason recorded
there.

### On the design, and a correction to this task

The Goal says the prototype has *"tabs across the top — `S1 … S4`, each with a
progress bar and `11/11`-style counts"*. **It does not.** There is no `S1`-style
tab row in any `docs/design/*.dc.html`, and no `N/N` count. What is there is a
sprint **picker card list** — `{{ r.frac }}`, `{{ r.pctText }}`, a progress bar of
`width: {{ r.pct }}`, and `🔒{{ r.blocked }}` — under the note *"Picking a sprint
here sets it on the board, the timeline and the sprint strip."*

So the behaviour AC4 asks for is right and the description of where it comes from
was not. I built the row from the elements that **are** in the file — the
fraction, the meter, the lock — which is also where the blocked lock in AC2 comes
from. Flagging it because a task file is a description and this one was
paraphrasing.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — 1742 server, **604** web, 49 cli. Six
mutations, all red.

### Two classes rendering identically, measured

```
.tl-bar-planned.tl-bar-todo                bg rgba(0,0,0,0)  border rgba(255,255,255,0.2)
.tl-bar-planned.tl-bar-todo.tl-bar-blocked bg rgba(0,0,0,0)  border rgba(255,255,255,0.2)
```

**Byte-for-byte identical, in both themes**, with a card-coloured dot on a
transparent bar. **Any assertion on class names would have passed for ever** —
so comparing the blocked bar's *computed* colour **against the unblocked one
beside it**, rather than against a constant, is the only instrument that could
see it. Same lesson as LAI-157's containment check, one screen over.

### Reuse found a bug that duplication had been hiding

| | last day of a sprint |
| --- | --- |
| `sprint-derive.daysLeft` — the board | **1** |
| `timeline-derive.sprintSummary` | **0** |

**Two screens, one sprint, two numbers**, and the timeline's test justified its
answer by citing §4.15 — which **says only that the dates are date-only** and
does not decide it. *"The conclusion contradicts its own premise: if the end day
is included, it **is** a day left."*

**That is the paraphrase problem in a test comment**, and it is the third
instance this week of a citation that named a real section and claimed something
it does not say. **Flipping the assertion with the flip written down** rather
than quietly changing it is what makes it reviewable.

> *"Reuse found a bug that duplication had been hiding. That is the opposite of
> the usual argument for reuse and I think it is the stronger one."*

**Agreed, and it is worth stating as the general form:** two copies of a rule do
not merely risk drifting — **they hide the drift from the moment it happens**,
because neither side has anything to disagree with.

**And the discriminated `countdown`** — `DAYS LEFT 6` · `ENDED 37d ago` ·
`STARTS IN 6d` — for the right reason: *a clamp turns a wrong number into a
misleading one, and `DAYS LEFT 0` cannot be told from a sprint ending tonight.*

### The hook violation nothing but running it could find

A `useState` placed beside the code that used it, after three early returns.
**React `#310`, a blank screen — and typecheck passed, every unit test passed,
because none of them mounts the component.** Fourth time this week the defect was
visible only to something that actually rendered.

### The task file was wrong and you checked it

My Goal described *"tabs across the top — `S1 … S4`, each with a progress bar and
`11/11`-style counts"*. **There is no such row in any `docs/design/*.dc.html`.**
What is there is a sprint **picker card list** — `{{ r.frac }}`, `{{ r.pctText }}`,
a meter, and `🔒{{ r.blocked }}` — under *"Picking a sprint here sets it on the
board, the timeline and the sprint strip."*

**I paraphrased a design file from memory and stated it as fact**, which is the
fault CORE named this week and my fifth of the class. **The behaviour AC4 asks
for was right; the provenance was invented** — and going to the file is where
AC2's non-colour marker came from, so the correction paid for itself.

### The three widenings, and the one you left for me

`LockIcon` extracted rather than pasted a third time, with `ProjectStats` moved
over byte-identically. `LoginScreen`'s padlock kept — *same drawing, different
sentence.*

**And `TaskCard` left alone on purpose**: its copy is `strokeWidth="2"` against
`2.2`, so converting it changes a **board** glyph in a **timeline** task.
**That is the right call and the right reason** — a shared component that
silently restyles a screen the task never mentions is a widening whatever its
line count. Filed thinking, not a decision, and it stays yours to raise.
