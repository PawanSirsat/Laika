---
id: LAI-1203
title: 'Polish sign-in, first boot, invite, reset password and 404 on top of the brand and glass work'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-11T10:00:00Z
finished: 2026-11-11T14:30:00Z
---

## Goal

Stacked on LAI-1132 (glass, PR #291) and LAI-1126 (brand, PR #269). The
public screens — `/login`, `/setup`, `/invite`, `/reset-password` — and the
404 get one clear hierarchy (brand lockup, one heading, one primary action),
the shared level-2 `GlassSurface` card on the calm ground, and forms that
behave well for keyboard and screen-reader users. UI only, existing API, no
new dependencies, `server/web/` only.

## Acceptance criteria

- [x] Each auth screen: brand lockup, one `h1`, one primary action; the card is
      a level-2 `GlassSurface` with no per-screen glass CSS (glass guard green).
- [x] Labels always visible; validation on blur and on submit; on submit the
      first invalid field is focused; server errors map to fields where the
      server names one, otherwise to a summary in an `aria-live` region.
- [x] Password show/hide toggle with an accessible name; caps-lock hint.
- [x] Busy submit per the repo's busy rule (spinner names the control, label
      does not swap).
- [x] Password rules shown up front on setup, invite and reset; success states
      say what happens next.
- [x] First boot shows progress through its steps and honest status copy
      (SQLite, never postgres).
- [x] 404 says what happened, links to My day, Spaces and back; no ⌘K hint.
- [x] Both themes, 390/768/1440, keyboard-only, reduced motion,
      reduced transparency; existing tokens only (no `theme.css` values changed).
- [x] Playwright: keyboard-only sign-in/setup/invite/reset, validation focus,
      server-error mapping, show/hide toggle, 404 links; mutated once to prove
      they fail.
- [x] Gate: `pnpm lint`, `pnpm format`, `server/web` typecheck and the whole
      `server/web` test script (sharded 4 ways) each exit 0.

## Notes (SHELL, at review)

- The card is `components/auth/AuthCard.tsx` → `GlassSurface level={2}`;
  `.auth-card` is no longer a blurred host in `glass.css` (removed from the
  pane, level-2, nesting-reset and forced-colours lists), so the signed-out
  card gets glass the same way as every other level-2 surface.
- `useValidatedForm` (`components/forms/use-validated-form.ts`) carries blur
  and submit validation and focuses the first `aria-invalid` field (or the
  `role="alert"` summary when the server named none).
- Blur validation fires only once the field has text. Tabbing past an empty
  field says nothing, and submit still catches it.
- 422 `details.issues[].path` maps to fields on setup (as before), invite
  (`name`/`email`/`password`) and reset (`new_password`).
- Caps Lock: Playwright cannot set the modifier, so its test dispatches a
  `keyup` with `modifierCapsLock` to the focused field.
- Mutation: removing the focus call in `useValidatedForm` turned 6 of the 14
  new tests red.
