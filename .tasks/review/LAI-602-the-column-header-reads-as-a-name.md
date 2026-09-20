---
id: LAI-602
title: The column header reads as a name, and renames in place
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-296
status: review
finished: 2026-09-20T19:00:38Z
started: 2026-09-19T21:01:11Z
---

## What the owner asked for

Against a reference showing `Backlog  8` — name in its own case, plain count
chip, nothing else until you point at it.

- **Cosmetics.** Ours was `uppercase` at `0.07em` tracking in the heavy weight,
  with a bordered monospace count. It read as a shouted label, and it *silently
  renamed the column*: one called `To Do` displayed as `TO DO`, so the header
  and the rename field disagreed about the column's name.
- **Chrome on hover only** — grip, `⋯` and the order select.
- **The name is the rename control**, opening an input in place with ✓ / ✕.
- **Clicking away closes it.** It stayed open until `✕` was pressed, so a
  column looked selected long after the reader had moved on.
- **The coloured dot stays.** Asked for explicitly when I offered to drop it —
  it is the only thing showing which status a drop lands in (D-027).

## Split across two commits, by accident

**The `board.css` half of this landed inside the other SHELL session's
`b106465 … [LAI-603]`.** They edited the same file for their own lane-head
task while my changes to it were uncommitted in the shared worktree, and
`git add <path>` staged the file, not their authorship. Verified nothing was
lost: `HEAD~1` still has `text-transform: uppercase`, the tree does not, and
`.lane-title` is this task's rule.

Left there deliberately rather than amended — relocating two hunks out of a
green commit risks live work for a tidier history. **The lesson is theirs and
worth keeping: `git diff --stat` before committing**, which would have shown
165 insertions where 12 were expected.

Their commit also removed `.lane-count-in_progress` / `-done` so the count is
one colour. That agrees with this task: a count that changes colour per status
competes with the dot to say the same thing.

## Acceptance criteria

- [x] Name in its own case, normal tracking, at a readable size.
- [x] Count is a plain filled chip — no border, no monospace, one colour.
- [x] Grip, `⋯` and order select are invisible at rest and appear on hover;
      `:focus-within` keeps them reachable without a pointer.
- [x] Clicking the name opens an input in place with ✓ / ✕; Escape cancels;
      an empty name is refused.
- [x] Clicking away closes it — with a `relatedTarget` check, or the blur
      cancels the `✓` it fires before.
- [x] The coloured dot survives.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Closure note (2026-09-21)

Built, shipped and long since deployed; the move to review was overtaken by
the owner's rapid-fire briefs. Two criteria describe the state at build time
and were later superseded on the owner's instruction: the plain one-colour
count became the prototype's tinted status badge (LAI-605/606), and the
hover-revealed grip was removed entirely - the header itself is the drag
handle now (LAI-605). Both supersessions carry their own tests.
