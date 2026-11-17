---
id: LAI-1204
title: Polished Button, Field and Icon primitives, with a bounded migration
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-11T10:00:00Z
finished: 2026-11-11T16:30:00Z
---

## Goal

One `Button`, one `Field`, one `Icon` — each with every state designed — and a
bounded, high-visibility set of screens moved onto them, so the rest of the
migration is a census with counts rather than a guess.

Scope is `server/web/` only, UI only, no API change, no new dependency, no
`theme.css` value change.

## Acceptance criteria

- [x] `Button` has variants primary, secondary, ghost, danger (plus the existing
      invite) and an icon-only form that requires an accessible name; sizes
      `sm` and `md`; a compact density from `[data-density="compact"]`.
- [x] `Button` states: hover, active/pressed, `:focus-visible`, disabled, and
      disabled-with-reason wired through `aria-describedby` to visible text.
- [x] `Button` busy follows LAI-293: spinner beside the label, label never
      swaps, `aria-busy`, activation blocked, focus kept.
- [x] Hit area ≥ 44px under `(pointer: coarse)`; icon+label spacing from one token.
- [x] `Field` is the one wrapper: label always visible, hint, inline error with
      `aria-invalid` + `aria-describedby`, required marker, optional character
      count; used by TextInput, a new Textarea, and Select (the `Dropdown`
      — no native `<select>`); field heights match Button `md`; disabled and
      read-only states.
- [x] `Icon` is one component over the in-house path set (NavIcon's paths moved
      into it), sizes tied to the type scale, `aria-hidden` by default and a
      `label` prop that makes it `role="img"`.
- [x] Migrated: sidebar footer/menu buttons, space settings forms, shared
      dialogs' footer buttons, sign-in-free shared toolbars.
- [x] A guard test stops raw `<button className=…>` coming back in the migrated
      files; the census of remaining hand-rolled buttons/inputs per file is in
      the PR.
- [x] Unit + Playwright tests for states, keyboard, busy rule, disabled reason
      and error focus; each key behaviour mutated once and seen red.
- [x] Both themes; 390/768/1440; reduced motion; keyboard and screen reader.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
fonts, colours only in `theme.css`): `impeccable` (critique → polish pass),
`emil-design-eng` (press feedback, transitions, hit areas), `break-ui`
(worst-case labels, non-Latin text, huge numbers).

Overlapping open PRs, kept clear of: #288 toast, #318 tabs/tooltip, #322 space
header, #291 glass, #316 organisation, #319 spaces.

## Delivered (LAI-1204)

- `components/icon/` — `Icon` and the one path registry; `NavIcon` now draws
  from it and stays only for the pixel-sized callers inside PR #319's files.
- `components/forms/` — `Button`, `IconButton`, `button-model.ts`,
  `button.css`, `controls.css` (sizes + `[data-density="compact"]`),
  `Field` (row layout, count, `id`), `TextInput`, `Textarea` (new), `Select`,
  `field-model.ts` (grapheme count, described-by order, focus-first-invalid),
  `ControlsGallery` on `/design/states`.
- Migrated: sidebar user menu (drawn moon/sun and caret; Sign out no longer
  swaps its label), OffboardingDialog and CreateTaskDialog (close + footer),
  space settings General/Members/Access/Danger, the Time report toolbar.
- Guard: `test/components/forms/raw-controls.test.ts` — exact per-file
  exception counts, widget roles exempt, raw text fields refused where forms
  moved.
- Tests: `test/browser/controls.test.ts` (15), unit tests for both models and
  the registry; `space-settings.test.ts` now also asserts the refused field
  takes the focus. Eleven mutations, all caught (see the log).
