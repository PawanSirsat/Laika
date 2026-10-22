---
id: LAI-973
title: 'plugin/README.md still tells people to turn on "Share my local activity"'
area: plugin
assignee: shell
priority: p2
depends-on: [LAI-971]
discovered-from: LAI-971
status: in-progress
started: 2026-10-22T16:33:31Z
---

## Acceptance criteria

- [ ] `plugin/README.md` (~125–128, ~164) and any other `plugin/` text
      (untruncated census, listed in the log) say collection follows the
      organisation's Developer insights (D-102 amended), using LAI-971's CLI
      wording; no claim of a personal switch or "sharing is off".
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Claim note (SHELL, Belka)

`depends-on: LAI-971` is in review, not in `.tasks/done/`, and its branch is
not in this base (@3a390cad). Claimed on CHIEF's direct dispatch; this is
prose in `plugin/` only and does not need LAI-971's code — it reuses the
wording LAI-971 put in the CLI.
