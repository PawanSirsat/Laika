---
id: LAI-215
title: Three components carry their own copy of initials()
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-070
status: backlog
started:
finished:
---

## Goal

`UserChrome.tsx`, `ProjectStats.tsx` and `TaskCard.tsx` each define a private
`initials(name: string)`. All three are character-for-character identical.

LAI-070 needed a fourth for the activity rail and extracted
`src/theme/initials.ts` instead of adding one, with tests. **The three existing
copies were deliberately left alone** — migrating working components is a
refactor of its own, not something to fold into the stream work that noticed it.

## Why it matters more than tidiness

The four sites render the same person, and a divergence between them is close to
invisible: the same face appears as `AL` in the sidebar and `AD` on a card, and
nothing fails. The extracted version already differs from the three copies in
one respect — it is **tested**, including the blank-name and irregular-spacing
cases the inline copies handle only by accident of their `.filter`.

## Acceptance criteria

- [ ] `UserChrome.tsx`, `ProjectStats.tsx` and `TaskCard.tsx` import
      `initials` from `src/theme/initials.ts` and define none of their own.
- [ ] No `function initials` remains anywhere under `src/` outside
      `src/theme/initials.ts`.
- [ ] Rendered output is unchanged for an ordinary two-word name — this is a
      move, not a redesign.
- [ ] A guard fails if a fourth private copy appears. The structural tests in
      `web/test/` are the existing idiom for this; prove it can fail.

## Notes

- Check `avatarColor()` alongside it — the same components pair the two, and if
  a call site is passing a stale `theme` rather than reading `useTheme()`, its
  avatar keeps the previous palette after a theme flip. That exact bug is
  described at the top of `src/theme/use-theme.ts` and is worth re-checking at
  each of the four sites while they are open.
