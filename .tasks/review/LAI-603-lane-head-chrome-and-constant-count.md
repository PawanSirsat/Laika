---
id: LAI-603
title: The lane head matches the design — chrome on hover, one count colour, real padding
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
started: 2026-09-19T20:58:40Z
finished: 2026-09-19T20:58:40Z
status: review
---

## Goal

**Direct owner instruction with a reference image**, during the LAI-295 session.
Four changes to the board's column header, all CSS:

1. The `⋯` menu appears **only when the column top is hovered**.
2. The drag grip is hidden the same way — **and column reordering still works**,
   which is why this is `opacity`, never `display`.
3. The task count badge is **one colour in every lane**.
4. Padding on the head and the badge, per the reference.

## Acceptance criteria

- [x] Grip and menu are invisible at rest in every lane.
- [x] Hovering **the head** reveals them **for that lane only**.
- [x] Hovering the lane **body** does not reveal them — it is the head, not the
      lane, which is what changed.
- [x] The count badge renders the same background and foreground in every lane,
      including `in_progress` and `done`, which previously took the accent and
      the green.
- [x] Keyboard reach is unchanged: `:focus-within` still reveals them, so the
      controls are not hover-only.
- [x] Measured on the running instance, not read off the diff.
- [x] Full gate, all three `EXIT 0`, under the shared lock.

## Verified

Measured at 1600x1000, dark theme, on `:3381`:

```
at rest          every lane   grip=0 menu=0
hover head #1    lane 1       grip=1 menu=1
                 lanes 2-4    grip=0 menu=0
hover lane body  every lane   grip=0 menu=0
count badge      all 4 lanes  bg rgb(27,27,32)  fg rgb(164,164,174)
padding          head 8px 10px   badge 3px 8px
```

Gate: TEST 0, LINT 0, FMT 0 — 1999 server, 1025 web.

## Notes / context

**The dot carries the status; the number is just a number.** The count took
`--acc` in `in_progress` and `--grn` in `done`, so one badge meant "three
tasks" in three different colours down a single board. The coloured dot beside
the title already says which lane it is.

**`opacity`, not `display`** — the controls keep their space, so the title does
not shift sideways the moment you point at it, and the grip stays draggable.
That was already the rule for these controls; only its **scope** changed, from
`.lane:hover` to `.lane-head:hover`.

**Only `board.css` is touched.** `LaneRow.tsx` emits a `lane-count-${dot}`
modifier still; it simply has no rules behind it now. Removing the emission is a
tidy-up for whoever next holds that file, not a behaviour change — flagged to
the other SHELL session rather than done from here.

**No task file preceded this**, contrary to §2. The owner asked for it directly
and asked for it fast; recorded here immediately on completion rather than
claimed first. Noted in `logs/shell-2026-09-20.md`.
