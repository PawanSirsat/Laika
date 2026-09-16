---
id: LAI-455
title: 'The Meeting review screen — transcript beside proposals, accepted per line'
area: web
assignee: shell
priority: p2
depends-on: [LAI-451, LAI-454]
discovered-from: LAI-450
started: 2026-09-16T14:43:02+05:30
finished: 2026-09-16T15:15:36+05:30
status: done
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

- [x] **Nothing is accepted by default.** The apply button sends
      `accepted_proposal_ids` and **an empty set is not "apply everything"** — a
      screen whose safe action is the one the user did not take is the wrong way
      round for a thing that rewrites a board.
- [x] **Each proposal shows its quote, and the quote is locatable in the
      transcript pane.** A proposal a human cannot trace to a sentence is one they
      cannot honestly accept. If the API gives an offset, use it; if it gives only
      the text, say so and highlight on match.
- [x] **All four tags render distinctly**, `NEW` / `CHANGED` / `DEAD` /
      `DECISION`, **in both themes**. `DEAD` proposes closing work — it must not
      read as the same weight as `NEW`.
- [x] **A `CHANGED` proposal shows what it changes *from*.** "Set status to done"
      is not reviewable; "in_progress → done" is.
- [x] **Discard is not next to apply**, and asks. It destroys the whole set.
- [x] **After apply, the screen says what landed** — per proposal, from the
      response, **not from what was selected.** LAI-451 refuses proposals
      individually; a screen that reports its own optimism is the defect this
      criterion exists to prevent.
- [x] An **expired** review renders read-only with the reason, not as an error
      and not as an empty state.
- [x] No demo module (D-032). Both endpoints exist by the time this starts.
- [x] Full gate green — **`EXIT 0`**, repo root.

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


---

## Submitted — SHELL

Root gate `EXIT 0` — 1909 server, **687** web, 75 cli. **Eleven mutations, all
red.**

### AC2 is half stale, and I built the half that survives

The criterion says the quote must be **locatable in the transcript pane**.
**D-056 removed the transcript pane** — §4.12 keeps a `transcript_hash` and never
the words, and quotes are the one exception. So:

- *"each proposal shows its quote"* — **done**, and asserted; a proposal without
  one is unreviewable and the server refuses to store it.
- *"locatable in the transcript pane"* — **there is nothing to locate it in.**
  The quote is the whole of the evidence, which is why it is never clamped.

The Sizing note about a 200 000-character pane is stale for the same reason.

### AC4 was not satisfied by my first pass

*"'Set status to done' is not reviewable; 'in_progress → done' is."* The proposal
carries **only the new value**, so my first version rendered `status done`. I
caught it by looking at the screen, not from a test.

The before now comes from the board — the project's tasks, indexed by key — and
where the board does not hold that task **the arrow is omitted rather than
invented**: `? → done` claims a fact nobody has. Both directions are asserted.

### The criterion the screen exists for

**What landed is read from the response.** `AppliedProposal` has **no refused
variant** — a proposal the server declined is simply absent from `applied`. So:

| | reads as |
| --- | --- |
| in `applied` | what it did — `created LC-4` |
| in `already_applied` | already applied, nothing changed |
| **accepted and absent** | **not applied — you may not make this change** |
| never accepted | nothing |

And a refusal is **amber, not red**: a member accepting a lead-only `decision` is
the ordinary case (LAI-451), not a fault. The mutation *"read what landed from
the selection"* turns three assertions red.

### Two mutations that came back green, and what each was

**Neither was a coverage gap in the end, and one was.**

*"The selection is not reset when the review changes"* was **real** — my tests
only ever opened one review. Switching reviews must not carry a tick across, or
somebody applies a proposal they accepted while reading a different meeting.
**Test added; the mutation is red now.**

*"Discard sits next to apply"* stayed green through three attempts because the
separation is **structural, not CSS** — the accepted-count sits between the two
controls, so no stylesheet change alone brings them together. Measured: 520px
with two CSS separators removed. **Moving the discard button inside the apply
group turns it red at `only 12px between discard and apply`**, which is the
regression that would actually matter.

### Wiring, and a wall I had already hit once

`MeetingReviewView` is paired. **`ApplyReviewResult` and `ProposalView` cannot
be** — the census derives served types from `*View` exports, so pairing anything
else turns *"PAIRS names a server type that no longer exists"* red. Same wall as
`PresenceEntry` in LAI-439, and I hit it again before remembering.
`meeting-reviews.test.ts` compares those two directly **including optionality**,
which the drift check discards.

**LAI-460's own check confirmed the wiring**: removing its four `LAI-455`
exemptions left it green, which is the endpoint-coverage axis doing exactly what
it was built for a few hours earlier.

---

## Accepted — CHIEF, 2026-09-03. **M6's exit criterion renders.**

Gate `EXIT 0` — 1909 server, **687** web, 75 cli. Eleven mutations from you, all
red. **Four from me, judged by exit code**, which is the rule I wrote this
evening after being caught by a mutation that never ran:

| mutation | |
| --- | --- |
| accepted-and-absent reported as never-sent | **RED** — *"a refused proposal reads as refused, not as applied"* |
| the selection is not reset when a different review opens | **RED** — *"accepting on one review leaves the next one empty"* |
| the `accepted.size === 0` early return removed | **green — and it is mine, not a gap** |
| `accepted` seeded on mount | **green — and it is mine** |

**Both greens are my mutations, not holes.** The empty-set property is enforced by
the **button being disabled**, which your browser test asserts directly — four
boxes unchecked, `apply.isDisabled()`, and `.mr-count` reading *"nothing
accepted"*. **I mutated the belt and left the braces on.** And seeding `accepted`
with an id matching no proposal changes nothing observable. **Mutate what the
assertion watches, not a redundant guard behind it.**

### The criterion the screen exists for

`AppliedProposal` has **no refused variant** — a declined proposal is simply
absent. **So *"accepted and absent"* is the whole finding**, and you had to derive
it rather than read it:

| | reads as |
| --- | --- |
| in `applied` | `created LC-4` |
| in `already_applied` | already applied, nothing changed |
| **accepted and absent** | **not applied — you may not make this change** |

**Amber, not red**, and your reason is the right one: *a member accepting a
lead-only `decision` is the ordinary case (LAI-451), and red would tell them they
did something wrong.* **The screen reports what the response says landed, and the
response says it by omission.**

### AC4 — you got it wrong, and caught it by looking

> *"The proposal carries **only the new value**, so I rendered `status done` —
> which is exactly what your criterion calls unreviewable. **I caught it by
> looking at the screen, not from a test.**"*

**And `? → done` claims a fact nobody has**, so the arrow is omitted when the
board does not hold that task. **Omitting rather than inventing, with both
directions asserted**, is the same instinct as LAI-064's version badge and
LAI-206's migration count.

### AC2 is half stale and you said so rather than ticking it

**D-056 removed the transcript pane after I wrote the criterion**, so *"locatable
in the transcript pane"* has nothing to locate it in. **The Sizing note about a
200 000 character pane is stale for the same reason.** Both are mine.

### The discard mutation that stayed green through three attempts

> *"**The separation is structural, not CSS.** The accepted-count sits between the
> two controls, so no stylesheet change alone brings them together — 520px with
> two CSS separators removed. **Moving the button inside the apply group turns it
> red at `only 12px`.**"*

**That is the right answer to a green mutation**: not *"the test is weak"* but
*"find the edit that actually causes the regression."* **Belt-and-braces, reported
rather than dressed up** — and it is the second time today you have reported a
green mutation instead of quietly re-aiming until it went red.

### LAI-439's census wall, hit a second time

`ApplyReviewResult` is not a `*View`, so pairing it reddens *"PAIRS names a server
type that no longer exists"*. **`meeting-reviews.test.ts` compares it and
`ProposalView` directly, including optionality** — *"which `fieldsOf` discards,
and which is the difference between a quote being impossible to omit and merely
unusual."* **That is a sharper argument for the direct comparison than the census
would have been.**

### And LAI-460 checked this task's own wiring the same evening

*"Removing its four `LAI-455` exemptions left it green."* **The axis built this
afternoon doing its job that night**, on the task that came after it.
