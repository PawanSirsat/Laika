---
id: LAI-416
title: An org admin acting outside their memberships renders as "Someone"
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-411
status: backlog
---

## Goal

`describeActor` resolves a name from the **project** members map
(`BoardScreen.tsx` fills it from `page.members`). An actor absent from that map
renders `"Someone"`.

**Org Owners and Admins hold implicit `lead` on every project and never need a
membership row** (`policy/can.ts` §3.2's structural rule). So an Admin who
comments on, claims, or moves a task in a project they are not a member of is
**not in `page.members`**, and the task detail now attributes their action to
"Someone".

This is not the departed-user case the code comments anticipate, and it is not
transient. It is the ordinary way an org Admin works.

**Before LAI-411 the same actor rendered as a raw ULID**, which was also wrong —
but *visibly* wrong. `"Someone"` is worse in one specific way: **it looks
deliberate.** A ULID in the UI is a bug report; "Someone" is a design decision
nobody made, and a reader has no way to tell that Laika knows exactly who it was.

Not a defect in LAI-411 — its criteria never mentioned unresolved actors, and
unifying the two sites onto one answer is what surfaced this. Filed rather than
folded in, per CLAUDE.md §2.

## Acceptance criteria

- [ ] An action taken by an org Owner or Admin who is **not** a member of the
      project renders **their name**, in the task detail and the board rail.
- [ ] The fix comes from **real data, not a guess** — either the members map is
      widened to cover every actor the activity feed can name, or `ActivityView`
      carries what is needed. Do not derive a label from an id.
- [ ] A seeded fixture proves it: an org Admin with no membership row in the
      project acts on a task, and the rendered name is theirs. **The test must
      fail if the actor falls back to `"Someone"`** — check LAI-093 first, which
      covers naming *which agent* and may overlap.
- [ ] `"Someone"` still appears for an actor who genuinely cannot be resolved —
      a deleted user. That case is correct and must not regress to a ULID.
- [ ] Whatever the fix, the rail and the task detail keep answering through the
      **one** `describeActor`. LAI-411's whole point was that the two had drifted.
- [ ] Both themes, rendered in a real browser. Full gate green.

## Notes

If the answer needs a server change — a wider members payload, or a name on
`ActivityView` — **do not make it from the UI.** File it with `area: server` and
add it to this task's `depends-on`.

No demo module: the endpoints exist (D-032).
