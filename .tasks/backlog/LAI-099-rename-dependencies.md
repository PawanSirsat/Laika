---
id: LAI-099
title: 'Rename `dependencies` to `blocked_by` — before M3, or never'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-091]
discovered-from: LAI-091
status: backlog
---

## Goal

`TaskView.dependencies` means **blocked by**. Since LAI-091 there is also
`blocks`, meaning the reverse — and next to it, `dependencies` no longer says
which direction it is. `blocked_by` would.

Builder-A raised it and deliberately did **not** rename it inside LAI-091,
because it is the wire contract the web client reads and a breaking change
deserves its own task rather than a ride-along. That was the right call.

## Why it has a deadline

**M3 ships tokens.** From then on, agents outside this repo read this API, and a
breaking rename stops being a two-file change and becomes somebody else's
migration.

So: **rename before M3, or accept the name permanently and stop discussing it.**
§4.5 already spells out what `dependencies` means, so the ambiguity is documented
either way — this is about whether the field says what it means without a
footnote.

**My recommendation is to do it.** The cost is only ever going up, there are no
external consumers today, and a field whose name needs a spec sentence to
disambiguate will be misread by every future reader.

## Acceptance criteria

- [ ] `TaskView.dependencies` → `blocked_by`, server and web together. **Both
      halves in one integration** — the client reads it, so a partial landing
      breaks the board.
- [ ] §4.5 and §6.4 updated, and the footnote explaining the old name removed —
      the point is that it is no longer needed.
- [ ] Readiness still depends **only** on `blocked_by`, never on `blocks` — the
      test LAI-091 added for that must still hold.
- [ ] No occurrence of the old name outside history.

## Notes / context

**This is a third instance of a change needing two owners at once** (after §4.16
in LAI-079 and §4.8 in LAI-098). If it is awkward again, that is the signal to
change the rule rather than route around it a third time — see LAI-098's closing
note.
