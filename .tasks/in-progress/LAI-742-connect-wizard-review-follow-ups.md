---
id: LAI-742
title: 'Connect wizard: the six LAI-741 review notes — rail halo, card scroll reset, hanging indent, test tightening, phone order'
area: web
assignee: chief
priority: p1
depends-on: [LAI-741]
discovered-from: LAI-741
started: 2026-10-12T13:35:33Z
status: in-progress
---

## Goal

The owner, 2026-10-12, **made on the owner's direct instruction**: a small
follow-up to LAI-741 (the Connect wizard, live), in
`server/web/src/routes/screens/connect/` (`ConnectScreen.tsx`,
`connect.css`, `connect-wizard.ts`) and their tests. No wording changes.

## Acceptance criteria

- [ ] **1. Rail halo and focus ring.** `.conn-rail`'s scroller no longer
      clips the rail buttons' 2px focus outline (2px offset) or the current
      step's 3px halo on the left and right. At 1366x768 the rail does not
      scroll sideways and the current step's outline box lies inside the
      rail's padding box.
- [ ] **2. Card scroll reset.** On a step or optional-entry change the card's
      scroller (`.conn-card-scroll`) goes back to the top before focus moves
      to the title (`preventScroll`). Scrolled down, a step change leaves
      `scrollTop` 0 and the eyebrow in view.
- [ ] **3. Hanging indent, robustly.** A wrapped continuation indents
      relative to its own line's start, in every engine, without depending on
      the `hanging` / `each-line` keywords; a line that starts with spaces
      never hangs left of its own text at 390px. The comment says what the CSS
      does. The rendered text stays byte-identical.
- [ ] **4.** `connect-wizard.test.ts` asserts where each block's note sits
      with explicit expected values per block id, not a loop restating
      `noteAbove`.
- [ ] **5.** `connect.test.ts`'s *Command copied* rail check waits for the
      rail text rather than reading it once.
- [ ] **6. Phone order.** Below 56rem the Optional group comes after the card,
      so the current step starts near the top; the four steps stay above the
      card. The desktop layout is unchanged. At 390 the card's top is above
      the Optional group and in the first half of the viewport.
- [ ] Each new or changed test shown red without its fix. Full gate from the
      repo root — `pnpm test`, `pnpm lint`, `pnpm format` — each exits 0.
- [ ] Screenshots, light and dark, at 1366x768 and 390, in
      `/tmp/laika-connect-wizard-3-shots/`.
