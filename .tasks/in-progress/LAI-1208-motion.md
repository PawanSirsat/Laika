---
id: LAI-1208
title: 'A motion system: timing and easing tokens, one reduced-motion rule, and a pass over every animation'
area: shell
assignee: shell
priority: p2
depends-on: []
discovered-from: null
status: in-progress
started: 2026-11-11T11:31:44Z
---

Dispatched by polly (phase 1 UX audit: "motion — 1 token, ~10 literal
durations"; proposal `design-system-and-libraries.md` §1.4: tokens and one
global reduced-motion rule). UI only, `server/web/` only.

## Goal

Every duration and curve in the web app comes from one small set of motion
tokens; one `prefers-reduced-motion` rule turns non-essential motion off while
every state change still shows; and the few moments that move do it with a
purpose — composite-only, interruptible, short.

## Acceptance criteria

- [ ] An untruncated census of every `transition`, `animation` and
      `@keyframes` in `server/web/src`, each marked keep / retune / remove,
      written outside the repo (`.polly/specs/motion-audit.md`).
- [ ] `src/styles/motion.css`, imported once: a duration scale (instant, fast,
      base, slow, plus the ambient loop lengths and D-071's 200ms glide) and an
      easing set (standard, enter, exit, drawer, emphasised). Not in
      `theme.css`. Names and values agree with PR #291's motion block so the
      two merge to one.
- [ ] One global `prefers-reduced-motion: reduce` rule in `motion.css`; the
      local per-file blocks it makes redundant are deleted. The one that holds
      a state rather than removing motion (the board's arrival glow) stays,
      named in the guard.
- [ ] One JS source for the query: `theme/motion.ts`'s
      `prefersReducedMotion()`, used by `board-motion.ts`.
- [ ] Existing motion migrated to tokens; layout-property and keyboard-driven
      motion removed (skip link `top`, sidebar `width`, sub-task progress
      `width`); five chevron transitions that never ran (`transform
      var(--transition)`) fixed.
- [ ] Key moments, subtle and interruptible: drawer rise on the drawer curve,
      dropdown panel open, button press feedback, the dragged card's fade.
      Toast motion is PR #288's file; its mapping is in the PR body.
- [ ] Guard test: no raw time literal, `cubic-bezier()` or `ease-in` in
      component CSS outside the token sheets; `prefers-reduced-motion` only in
      `motion.css` (plus the named exemption) and `theme/motion.ts`; every
      exemption proved still needed.
- [ ] Browser test: the key moments run with token durations; under reduced
      motion they run in 0s and every state still lands. Each key behaviour
      mutated once and seen red.
- [ ] Gate: lint, format, web typecheck, and the web test script in four
      shards, each exit 0.

## Notes

Design skills used (advice only; repo rules win): `improve-animations`
(audit), `review-animations`, `animate`, `remove-animations`,
`animation-performance`, `emil-design-eng`. Not used: oil-ui, stageshow,
taste-skill. No new dependencies; no JS animation library (the CSP forbids
runtime style injection and Motion is not approved).

Overlapping open PRs, edited no further than token substitution and
non-adjacent motion lines: #291 glass, #288 toast, #289 drawer, #322 space
header, #317 palette; LAI-1205 overlays in parallel.
