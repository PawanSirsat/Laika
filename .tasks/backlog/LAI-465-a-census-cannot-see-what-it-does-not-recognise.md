---
id: LAI-465
title: 'Three guards this week decided their own reach and none reported it'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-454
status: backlog
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

- [ ] **Every guard that discovers its own inputs reports what it found**, not
      only what it objected to. A census that prints *"14 served types checked"*
      is falsifiable by a reader; one that prints nothing is not.
- [ ] **`response-type-coverage` fails when its discovery finds nothing**, the
      way `finds task files at all` and `finds the statements it claims to check`
      already do. An empty input set must be a failure, never a pass.
- [ ] **Name the discovery rule in the file, next to the discovery.**
      *"A served response type is one whose name ends `View` or that appears in a
      `c.json<T>`"* is a **convention the codebase must follow**, and it is
      currently enforced by nothing. Either assert it, or say plainly in the
      comment that it is a heuristic and what escapes it.
- [ ] **Sweep for a fourth.** Any guard in `server/test/tooling/` that builds its
      own input list — by suffix, by regex, by directory walk — gets the same
      question asked of it. **Report what you find, including "nothing else."**
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**This is not a request to make the guards stricter.** A heuristic reach is often
the right one — LAI-163 argued convincingly that inferring nullability from
silence would fail on most of the schema, and that argument still holds. **The
defect is the silence about the reach, not the reach.**

**CORE named this rather than filing it**, on the grounds that it was the third
instance of one pattern in a day and the pattern deserved treating over the
instance. **They were right, and this is that task.**
