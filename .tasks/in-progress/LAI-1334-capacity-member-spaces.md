---
id: LAI-1334
title: "Capacity's Spaces column shows the spaces a person is in, not only where they have open work"
area: server
assignee: chief
priority: p1
depends-on: [LAI-1331]
status: in-progress
started: 2026-11-18T13:05:51Z
---

## Goal

The owner, 2026-11-18, reported twice. Board card LAIKA-1140. On Ksage's Insights → Capacity,
Savita shows *0 No spaces* although she is a member of spaces.

**Cause.** `capacityNow` (`server/src/services/presence.ts`) builds `spaces` only from the
person's open assigned tasks — *"Spaces they have open work in"* — so a person with no open
tasks has none.

**Census: only Capacity does this.** It affects the list (`CapacityList.tsx`) and the cards
(`CapacityCard.tsx`). The Time → availability list (`people-load.ts`), AddToProjectDialog, the
sidebar and Organisation → Spaces already build from memberships.

**Fix.**
- Server: `spaces` is every space the person is a member of **that the reader can see** (the
  same visibility), each with its workload counts — zero where there is no open work. Open-work
  spaces first, most committed first; then the rest A–Z.
- Web: a space with open work keeps its count chip; a member space with none is greyed out,
  with no count. The count beside the column, the per-space filter and load
  (`capacity-derive.ts`) and *All spaces* stay correct. The header says what the column shows.

Scope: area `server` and, named, `server/web/`'s Capacity screen and its API mirror; SPEC's
Capacity read (§6.4) and §11.4.2.1's Capacity line (CHIEF, 2026-11-18). After #390 (LAI-1331)
merged, never folded into it.

## Acceptance criteria

- [ ] A member with no open tasks lists their member spaces, greyed out.
- [ ] Someone with open work in one of two spaces shows that space first with its count, and the
      other greyed out.
- [ ] Spaces the reader can't see never appear.
- [ ] Browser tests for the list and the cards; view-type-drift kept.
- [ ] CI is green on the PR; an independent review.

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR. CHIEF merges.
