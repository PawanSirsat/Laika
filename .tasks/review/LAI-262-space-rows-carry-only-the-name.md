---
id: LAI-262
title: 'A space row in the sidebar is a dot and a name, nothing else'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-249
started: 2026-09-18T16:18:13+05:30
finished: 2026-09-18T16:22:57+05:30
status: review
---

## Goal

**Owner-reported: "dont shwo the no. task there and the members as well i dont
think you are follwoing teh right deisgn".** They are right, and checking the
prototype settles it.

`Laika Prototype.dc.html` line 2298 maps a sidebar row to
`{ label: n[1], abbr: n[2], badge: … }`, and the row markup (lines 72–79)
renders, in wide mode:

```
[4px dot bar]  [label at 12px]  [chevron, only for "More spaces"]  [badge]
```

and in **mini** mode the two-letter `abbr` **instead of** the label. For a
space row `badge` is `''` — only `meeting` and `sprints` have one.

So a space row in the design is a **dot and a name**. Two things we render are
not in it:

1. **`N tasks · M members`** — that is `s.meta`, and it appears in the
   **More-spaces popover** (line 2265, `popSpaces`), never in the rail. LAI-248
   AC1 asked for it in the sidebar; that was a misreading of the design and the
   owner has now said so.
2. **The two-letter key in wide mode.** It is `abbr`, and the template shows it
   only under `sc-if navMini`. Ours renders it at both widths.

## Acceptance criteria

- [x] A space row in the expanded rail renders the project's **name** and the
      active-state dot, and nothing else — no counts, no member figure, no key.
- [x] The collapsed 56px rail renders the two-letter key **instead of** the
      name, the same way a route row already does.
- [x] The More-spaces popover keeps `N tasks · M members`: that is where the
      design puts it, and it is the one place a reader compares spaces.
- [x] Rows are one line again — the two-line height existed only to carry the
      meta.
- [x] A browser test reads an expanded space row's text and asserts it is the
      name alone; another asserts the key appears when collapsed.
- [x] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**This supersedes LAI-248's AC1** as written (`N tasks · M members` from
`task_counts` and `member_count` in the sidebar). LAI-248 is in
`.tasks/review/`; CHIEF should record the correction rather than treating it
as a failed criterion — the data is real and it is in the right place now.

**Tests that read `.space-key` to identify rows will need another selector.**
Several use it to read the list's order and membership; the key stops being
present in wide mode, so those need to read the row's label instead. Keeping
them working by keeping the key visible would be the tail wagging the dog.

## Completion notes

**Verified against the running instance**, which is where the owner saw it:
the rail now reads `Laika Core / Laika Infra / Laika Web` and nothing else.

`.space-key` and `.space-meta` are gone. A space row uses `.sidebar-mini` for
its two letters — the same element a route row already used — so the collapsed
rail behaves identically for both, and there is one mechanism rather than two.

**The tests had to stop identifying rows by the key**, since it is no longer
rendered at the width they run at. They read `.space-row .sidebar-label` now.
That is a better selector anyway: it names the row, not an ornament the design
may or may not draw.

**A row's `title` still carries `N tasks · M members`.** A tooltip is not the
rail — it costs no space, says nothing until asked, and keeps the counts one
hover away for someone choosing between spaces.
