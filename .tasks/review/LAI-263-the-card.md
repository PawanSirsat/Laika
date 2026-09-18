---
id: LAI-263
title: 'The card: padding, type, comment count, timestamp, one-line blocked banner'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-251
started: 2026-09-18T17:02:58+05:30
finished: 2026-09-18T17:09:02+05:30
status: review
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

- [x] Card padding, title size/weight/leading and the two-line clamp measured
      against the prototype in a browser test — not eyeballed.
- [x] The comment count renders from `comment_count`, is **absent at zero**,
      and a task with comments shows the real number. **Closes LAI-223** —
      note it for CHIEF's dedupe.
- [x] The relative timestamp comes from `updated_at` and is computed against
      `Date.now()`, never a fixed epoch (the LAI-420 shelf-life bug, twice
      already).
- [x] The blocked banner is one line, ellipsised, and a browser test asserts
      its height does not grow with a long blocking title.
- [x] The footer's order matches the design: priority dot, ticket id, sprint
      badge, comment count, link count, timestamp — with the assignee avatar
      bottom-right.
- [x] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [x] Full gate — all three `EXIT 0`, repo root.

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

## Completion notes

Measured on the running instance, not eyeballed: padding `13px 13px 11px`,
title `13.5px / 600`, blocked banner `22px` — one line, where it was two.

**`comment_count` renders at last.** LAI-223 is closed against this — the field
has been on every task since the endpoint existed and no card ever showed it.
Absent at zero, because a `0` beside the link count reads as a control.

**`updatedAge` delegates to `staleFor`** rather than becoming a third copy of
the same arithmetic. The two existing copies are deliberate and the file says
why; a third would guard nothing, since this is the same question in the same
units asked about `updated_at`. The only difference is wording — a footer
stands alone, so `now` becomes `just now`.

**The one-line banner is a trade, and it is stated in the CSS.** The second
line existed because a 167px column left the blocker's title 17px — one
character. The owner asked for the design's single line; the title truncates
first, the key never does, and the whole line is in the `title` attribute.

**A test-selector lesson worth keeping.** `locator('.card', { hasText: 'Presence
strip' })` matched *two* cards: a blocked card repeats its blocker's title
inside the banner. Scoping by `.card-key` fixed it. Any test that identifies a
card by its title is ambiguous the moment that task blocks another.

**Not in this task, by the owner's decision**: `WIP 3/4` and a column reviewer
have no data model, and inventing either is what §5.1 forbids. Filed as
LAI-267 and LAI-268 for CORE.
