---
id: LAI-263
title: 'The card: padding, type, comment count, timestamp, one-line blocked banner'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-251
started: 2026-09-18T17:02:58+05:30
status: in-progress
---

## Goal

Owner-reported against the reference, with a populated board in front of them.
Five things about the card, all of them in `TaskCard.tsx` and `board.css`, and
**every value real** — the data for all of it already exists on `TaskView`.

1. **Padding.** More room top, bottom and sides. The prototype's card is
   `padding: 13px 13px 11px` with `gap: 8px` (line ~290).
2. **Title.** Larger and heavier: the design's `13.5px/600`, `line-height 1.4`,
   `letter-spacing -.008em`, clamped to two lines. Ours reads too light.
3. **Comment count.** `comment_count` is served on every task and **the card
   has never rendered it** — this is LAI-223, filed and still open. A
   speech-bubble icon and the number, beside the existing link count.
4. **Relative timestamp.** `updated_at` is on the task; the footer should end
   with "just now" / "2h" / "3d", right-aligned.
5. **The blocked banner reads on one line**: `blocked by LC-1 Presence strip
   reads the heartbeat table`, truncated with an ellipsis. Today it wraps to
   two, which is the one visible difference from the reference's banner.

## Acceptance criteria

- [ ] Card padding, title size/weight/leading and the two-line clamp measured
      against the prototype in a browser test — not eyeballed.
- [ ] The comment count renders from `comment_count`, is **absent at zero**,
      and a task with comments shows the real number. **Closes LAI-223** —
      note it for CHIEF's dedupe.
- [ ] The relative timestamp comes from `updated_at` and is computed against
      `Date.now()`, never a fixed epoch (the LAI-420 shelf-life bug, twice
      already).
- [ ] The blocked banner is one line, ellipsised, and a browser test asserts
      its height does not grow with a long blocking title.
- [ ] The footer's order matches the design: priority dot, ticket id, sprint
      badge, comment count, link count, timestamp — with the assignee avatar
      bottom-right.
- [ ] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**Nothing here needs generated data.** `comment_count`, `updated_at`,
`blocked_by`, `tags`, `priority` and `assignee_id` are all on `TaskView`
already; the seeded instance shows every one of them populated.

**`WIP 3/4` and a column reviewer are not in this task** — neither exists in
the data model, and the owner chose real configuration over invented numbers.
Filed as LAI-267 and LAI-268 for CORE. Until LAI-267 lands the In Progress
header shows the count with no denominator.

**The agent badge on the avatar already exists** and did not show on the
seeded board because every seeded task was created via `web`. A task created
through MCP renders it. Worth confirming rather than rebuilding.
