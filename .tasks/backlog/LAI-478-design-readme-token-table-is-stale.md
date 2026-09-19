---
id: LAI-478
title: "docs/design/README.md's token table still shows the pre-lift values"
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-278
status: backlog
---

## Goal

**`docs/design/README.md` contradicts itself**, and the half that is wrong is the
half people read.

Line 40, the prose, is **correct and current**:

> *"nine tokens we hold lifted for contrast — `--tx3 #8d94a4 → #606775`,
> `--acc #2f6bff → #2158e0`, and the same for red / green / amber / purple; dark
> `--tx3 #71717d → #9a9aa4`"*

Lines 103–104, the token table, still show the **pre-lift** values:

| | light | dark |
| --- | --- | --- |
| `--tx3` | `#8d94a4` | `#71717d` |
| `--acc` | `#2f6bff` | `#5b8cff` |

**The shipped app uses the lifted values.** Measured off the running page in both
themes during the LAI-278 review: `--tx3 #606775` light, `#9a9aa4` dark, `--acc
#2158e0` light. `tokens.css` agrees, and `tokens.test.ts` pins `token-list.ts`
against it.

So the code is right, the prose is right, and **the table a reader is most likely
to copy from is wrong.**

## Why this is the owner's call and not mine

**D-020: CHIEF never changes a design token, a colour, or any value in
`docs/design/`.** That directory is the owner's imported visual reference. I may
measure it, report a failure and recommend a fix — I may not decide one. This
task is that report.

**The recommendation:** update the table's `--tx3` and `--acc` rows (and the
red / green / amber / purple rows, which the prose says moved with them) to the
lifted values, so the table matches its own paragraph and the shipped palette.

## Acceptance criteria

- [ ] The table at `docs/design/README.md` lines 103–104 and its sibling colour
      rows carry the same values as `server/web/src/theme/tokens.css`.
- [ ] The prose at line 40 and the table no longer disagree.
- [ ] No change to `tokens.css` — **the code is already correct.** If anything
      here tempts a code change, stop: that would be reverting LAI-246.

## Notes / context

**This predates the 27-task design pass** and is not a defect in it. LAI-246 did
the lift; the README table was not carried along, and nothing could have caught
it — **no test reads `docs/design/README.md`.**

**It is the third "prose nobody parses" drift in two days** — the SPEC's
*"three spaces"* (D-061) and its *"840px drawer"* (D-063) were the other two, and
both were fixed by removing the unfalsifiable figure. **That answer is not
available here**: this table *is* the design reference, and the numbers are the
point of it. A guard reading the README against `tokens.css` is the only real
option, and whether that guard is worth building is a separate question — file
it if the answer is yes, do not smuggle it into this task.
