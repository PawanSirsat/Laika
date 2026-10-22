---
id: LAI-973
title: 'plugin/README.md still tells people to turn on "Share my local activity"'
area: plugin
assignee: unclaimed
priority: p2
depends-on: [LAI-971]
discovered-from: LAI-971
status: backlog
---

## Acceptance criteria

- [ ] `plugin/README.md` (~125–128, ~164) and any other `plugin/` text
      (untruncated census, listed in the log) say collection follows the
      organisation's Developer insights (D-102 amended), using LAI-971's CLI
      wording; no claim of a personal switch or "sharing is off".
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
