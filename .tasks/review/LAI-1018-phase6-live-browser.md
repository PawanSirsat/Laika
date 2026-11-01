---
id: LAI-1018
title: 'Phase 6 live browser qualification: agent and hand-off screens, keyboard and both themes'
area: chief
assignee: chief
priority: p1
parent: LAIKA-785
depends-on: []
discovered-from: LAI-559
started: 2026-11-01T07:29:30Z
status: review
finished: 2026-11-01T10:38:05Z
---

## Goal

Close the *keyboard / accessibility UNVERIFIED* rows in `docs/acceptance`
(LAI-559 failure matrix row 26, the LAI-560 evidence pack) with real browser
evidence against **production**, project `laika`: Playwright driving Chromium,
light and dark, at 1440 px and 390 px, keyboard only.

## Acceptance criteria

- [x] Each screen below is walked in both themes at 1440 and 390 px with the
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
- [x] `docs/acceptance/LAI-1018-live-browser.md` gives a PASS / FAIL table per
      check, with screenshot paths under `.polly/evidence/LAI-phase6/`
      (gitignored, tokens masked).
- [x] Every real defect is filed as its own task and card; no code is
      changed here.
- [x] Only a sandbox card made for this run is changed; nothing is marked Done.

## Notes / context

- axe-core is not a dependency of this repo, so no automated scan runs; the
  checks are made by hand from the accessibility tree and the DOM.
- One browser at a time, no test suites locally (Belka).
- The board password is read from Keychain inside the script and never printed.

## Result

`docs/acceptance/LAI-1018-live-browser.md`. All five screens were walked in
all four configs, on production `8469099f` (screen 1 on `37fec80b`; #175
changed none of its files). Of the six sections, three pass outright; §2 passes, with the checkpoints /
recovery panel and the hand-off review dialog UNVERIFIED (below). Two
checks fail: focus is not restored when the task drawer closes (LAI-1021,
LAIKA-877) or when the Project context panel closes (LAI-1022, LAIKA-878).
LAI-1023 (LAIKA-879, p3) covers identical "Context" button names.

**Deviation from criterion 1, stated rather than ticked away:** two
items it names could not be walked: the drawer's **checkpoints / recovery
panel**, which renders only for a task with a checkpoint (only LAIKA-875,
excluded; no gallery specimen), and the drawer's hand-off *review* dialog
(`HandoffOfferDialog`), which renders only for a live offer. The only live offer belongs to LAIKA-875,
another test's sandbox that this walk was told not to touch, and making one
on LAIKA-876 needs a claim, a pushed `laika-ckpt/` tag and an offer delivered
to another agent. The *offer* dialog, the unavailable agent options and the
Connection lost / Save needs attention states, none of which exist live,
were checked in production's `/design/states` gallery and are labelled as
component-level evidence.

The only production data changed is LAIKA-876's Backlog position, which
moved and ended where it started.
