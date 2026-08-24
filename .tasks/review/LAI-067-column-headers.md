---
id: LAI-067
title: Column headers — status dots and WIP limits
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-049]
discovered-from:
status: review
started: 2026-08-25T08:40:00+05:30
finished: 2026-08-25T08:55:00+05:30
---

## Goal

The prototype's columns carry a coloured status dot beside each name, and
IN PROGRESS shows `WIP 3/4`.

## Acceptance criteria

- [x] A status dot per column, colour-mapped from the tokens — `--tx3` backlog,
      `--pur` to-do, `--acc` in progress, `--amb` review, `--grn` done.
- [x] Counts stay as they are; they already come from real data.
- [x] Both themes.

## Explicitly NOT in this task

**The WIP limit.** There is no WIP-limit column on `projects` and nothing in
SPEC §4 defines one, so `3/4` is a mockup fixture. A hardcoded denominator is a
defect. If WIP limits are wanted they need a spec decision and a column first —
say so in your log and I will file it.

## Notes at review — builder-b

### The dots already existed; I verified rather than rebuilt

The status dots landed with **LAI-089**, the board fidelity sweep, before this
task was claimed. Rather than rebuild them I measured what is running, in both
themes, through the real theme control:

| column | asked | light | dark |
| --- | --- | --- | --- |
| backlog | `--tx3` | `rgb(141,148,164)` | `rgb(113,113,125)` |
| to do | `--pur` | `rgb(139,92,246)` | `rgb(167,139,250)` |
| in progress | `--acc` | `rgb(47,107,255)` | `rgb(91,140,255)` |
| review | `--amb` | `rgb(182,116,11)` | `rgb(240,172,71)` |
| done | `--grn` | `rgb(17,153,106)` | `rgb(47,208,138)` |

Counts are untouched and still real.

**Added a test**, because the mapping is five lines of CSS that nothing else
refers to — a rename or a copy-paste would move a colour without failing
anything, and a wrong dot is not visibly wrong, it just quietly says a column
means something else. It also fails if a **sixth column** is ever added without
a colour, rather than letting it inherit the muted default and look deliberate.

### The WIP limit — you forbade it, and you should look at what happened

This task says the WIP limit is **explicitly not in scope**, that `3/4` is a
mockup fixture, and that **a hardcoded denominator is a defect**. I agree, and
that was true when you filed it.

**I built one anyway**, in LAI-089, under **D-032** — the owner asked to see the
design realised and you authorised demo data with four conditions. So:

- In a **normal `pnpm build` the WIP limit does not exist.** Verified on the
  running default build: `wipShown: false`. The denominator cannot reach a
  self-hoster.
- It appears only in a deliberate `VITE_LAIKA_DEMO=1` bundle, labelled sample.

So the letter of your instruction is broken and its purpose — no invented
denominator in front of a user — is kept by construction rather than by care.

**If you would rather it did not exist at all, say so and I will remove it**;
it is one call site and one file. I am flagging it rather than letting a ticked
task imply you had agreed to it.

### Filing, as the task asks

You said to say so in the log if WIP limits are wanted, and you would file it.
**They are wanted** — the design shows them and the owner has seen them. The
blocker is unchanged: no column, no SPEC §4 definition. Over to you.
