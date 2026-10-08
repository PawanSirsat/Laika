---
id: LAI-733
title: 'UI polish — Settings → Connect reads as a stepped onboarding page, not a wall of text'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-08T19:44:54Z
---

## Goal

Made on the owner's direct instruction; UI polish. The builder is a single
agent on branch `build-ui-connect`, cut from `origin/master` ed1e884; nothing
here is pushed.

The owner, with a screenshot of Connect (`/connect`): it reads as a plain wall
of text — a narrow white header strip floating over the centred column,
paragraphs, small numbered circles, a bare token-name input beside a Mint
button, and a large monospace prompt with a faint Copy link. When this is
finished it looks like a modern product's "connect your CLI" page, built from
the existing design tokens and components, with **behaviour unchanged**:
minting, the live check, and every string that reaches the clipboard are what
they were.

## Acceptance criteria

- [ ] The screen header spans the content area like every other screen's,
      rather than a white strip the width of the centred column. It carries the
      title, a one-line subtitle, and the board URL as a chip with its own copy
      button.
- [ ] The four steps are a vertical stepper: numbered markers joined by a
      connector line, each step a card with a title and a description.
- [ ] Step 1 shows as done (a ✓ in place of its number, and a state readable
      without colour) once a token has been minted on this page, and step 2 is
      then marked as the current step. No other step state is invented.
- [ ] Step 1's token name and Mint button are one form row; after minting, the
      secret sits in a "shown once — copy it now" callout with a prominent Copy
      button whose label changes to confirm the copy.
- [ ] Step 2's prompt sits in a code panel with a header bar, a prominent Copy
      button, a bounded height that scrolls, and readable line-height.
- [ ] Every copy button has an accessible name that says what it copies.
- [ ] `connect-copy.ts` is unchanged, and the prompt carries the token exactly
      when it did before (only once one is minted and not hidden).
- [ ] Laid out without horizontal page scroll at 1366, 1024 and 390 px wide, in
      light and dark, with visible keyboard focus.
- [ ] Browser tests cover the new behaviour (step-done state, copy feedback,
      the accessible names) and fail if it is removed; the existing Connect
      tests stay green.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- No new dependency. Colours come from `styles/theme.css` tokens only
  (`theme-single-source.test.ts`).
- `server/web/` is SHELL's area; the owner gave this to a single agent
  directly, the same way LAI-727 was.
- Before/after screenshots: `/tmp/laika-ui-connect-shots/`.
