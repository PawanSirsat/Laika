---
id: LAI-455
title: 'The Meeting review screen — transcript beside proposals, accepted per line'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-451, LAI-454]
discovered-from: LAI-450
status: backlog
---

## Goal

**M6's exit criterion is this screen.** *"Paste a standup transcript, review the
proposal, apply it, and the board reflects the meeting."* Everything else in M6
is built or filed; the review step has nowhere to happen.

§11.4.2 specifies it exactly:

> *Transcript on one side, proposals on the other tagged **NEW / CHANGED / DEAD /
> DECISION**; each proposal shows its transcript quote; per-line accept and
> reject; apply acts only on accepted items; discard the set.*

## Acceptance criteria

- [ ] **Nothing is accepted by default.** The apply button sends
      `accepted_proposal_ids` and **an empty set is not "apply everything"** — a
      screen whose safe action is the one the user did not take is the wrong way
      round for a thing that rewrites a board.
- [ ] **Each proposal shows its quote, and the quote is locatable in the
      transcript pane.** A proposal a human cannot trace to a sentence is one they
      cannot honestly accept. If the API gives an offset, use it; if it gives only
      the text, say so and highlight on match.
- [ ] **All four tags render distinctly**, `NEW` / `CHANGED` / `DEAD` /
      `DECISION`, **in both themes**. `DEAD` proposes closing work — it must not
      read as the same weight as `NEW`.
- [ ] **A `CHANGED` proposal shows what it changes *from*.** "Set status to done"
      is not reviewable; "in_progress → done" is.
- [ ] **Discard is not next to apply**, and asks. It destroys the whole set.
- [ ] **After apply, the screen says what landed** — per proposal, from the
      response, **not from what was selected.** LAI-451 refuses proposals
      individually; a screen that reports its own optimism is the defect this
      criterion exists to prevent.
- [ ] An **expired** review renders read-only with the reason, not as an error
      and not as an empty state.
- [ ] No demo module (D-032). Both endpoints exist by the time this starts.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**This is the highest-stakes screen in Laika**, and it is worth saying why: every
other screen shows the user what is on the board. This one asks them to authorise
**an LLM's reading of a conversation** to change it. The design job is not to make
accepting easy — it is to make **accepting something wrong hard**.

**Which is why "accept all" is not in the criteria.** If it is added later it
should be a decision with a reason, not a convenience that arrives during
implementation.

**Sizing:** the transcript can be 200 000 characters (LAI-450's cap). The pane
scrolls independently; the page body does not scroll sideways.
