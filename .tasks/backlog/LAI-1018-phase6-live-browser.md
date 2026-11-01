---
id: LAI-1018
title: 'Phase 6 live browser qualification: agent and hand-off screens, keyboard and both themes'
area: chief
assignee: unclaimed
priority: p1
parent: LAIKA-785
depends-on: []
discovered-from: LAI-559
status: backlog
---

## Goal

Close the *keyboard / accessibility UNVERIFIED* rows in `docs/acceptance`
(LAI-559 failure matrix row 26, the LAI-560 evidence pack) with real browser
evidence against **production**, project `laika`: Playwright driving Chromium,
light and dark, at 1440 px and 390 px, keyboard only.

## Acceptance criteria

- [ ] Each screen below is walked in both themes at 1440 and 390 px with the
      keyboard only (Tab, Shift-Tab, arrows, Enter, Escape), checking that
      focus is visible, focus returns to its opener after a dialog closes,
      state is named in text rather than by colour alone, and the page does
      not scroll sideways:
      1. Developer access › Agents (list, register wizard steps, the
         duplicate harness · device notice, rotate confirm, consent switch)
         and Your devices (the revoke-device dialog, then Cancel).
      2. Task drawer: the Agent picker combobox (APG: `aria-expanded`,
         `aria-activedescendant`, unavailable options announced, Escape),
         the execution panel, the checkpoints / recovery panel, and the
         hand-off dialog's focus trap.
      3. Board cards: the agent chip, Working / Connection lost, the recovery
         and save states; opening a card, moving it by keyboard, and dragging
         it still work.
      4. Inbox › Hand-offs tabs (arrow keys, Home / End) and Settings ›
         Access hand-off policy.
      5. Project context History / Compare / Delivered to.
- [ ] `docs/acceptance/LAI-1018-live-browser.md` gives a PASS / FAIL table per
      check, with screenshot paths under `.polly/evidence/LAI-phase6/`
      (gitignored, tokens masked).
- [ ] Every real defect is filed as its own task and card; no code is
      changed here.
- [ ] Only a sandbox card made for this run is changed; nothing is marked Done.

## Notes / context

- axe-core is not a dependency of this repo, so no automated scan runs; the
  checks are made by hand from the accessibility tree and the DOM.
- One browser at a time, no test suites locally (Belka).
- The board password is read from Keychain inside the script and never printed.
