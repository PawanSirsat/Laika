---
id: LAI-064
title: App shell chrome — sidebar identity, counts, and the user/theme footer
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-058]
discovered-from:
status: in-progress
started: 2026-08-24T23:50:00+05:30
---

## Goal

Bring the shell up to `docs/design/Laika Prototype.dc.html`. **Style only — the
tokens are already correct** (I measured all fourteen against
`docs/design/README.md` and every one matches, both themes). What differs is
composition.

| Prototype | Built today |
| --- | --- |
| Logo with `laika-core · v0.4` mono subtitle | logo, no subtitle |
| Counts on nav items (Sprints `4`, Meeting review `4`) | none |
| User chip bottom-left: avatar, name, role | top-right |
| Theme control bottom-left | three radios top-right |

## Acceptance criteria

- [ ] The sidebar carries the **active project context** under the wordmark —
      slug and whatever version string the API actually provides. **If no
      endpoint returns a version, show the project slug alone and say so in your
      log; do not invent `v0.4`.**
- [ ] The signed-in user sits at the **bottom of the sidebar** — avatar from
      `theme/avatar-color.ts`, name, and org role — with sign-out reachable.
- [ ] The theme control moves to the sidebar footer.
- [ ] **Keep all three theme options.** The prototype shows a two-way "Switch to
      dark" because a mockup has no OS to follow. Dropping `System` would be a
      regression; match the placement, not the affordance count.
- [ ] Nav counts render **only where a count is real**. A hardcoded `4` is a
      defect (CLAUDE.md §5.1). If a screen has no count endpoint yet, omit it.
- [ ] Both themes; no new colour values (D-020).

## Notes / context

**Do not copy the prototype's markup** — it is inline-styled output from a
foreign runtime.

The counts are the part most likely to tempt a shortcut. `Sprints 4` and
`Meeting review 4` are fixtures in the mockup. Sprints has a real endpoint
(LAI-050); meeting review does not exist. Show the first, omit the second.
