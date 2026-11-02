---
id: LAI-1068
title: 'After laika update, the Devices tab still shows the old version until each tool reconnects'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-1064]
discovered-from: LAI-1065
status: backlog
---

`laika tool add` sends a client report (`POST /api/v1/agents/me/client-report`,
SPEC §4.81) with the tool's own token, so the board's Devices tab knows the
helper's version, commit and protocol. `laika update` moves the checkout to a
new commit and sends nothing, so the Devices tab keeps showing the old
version ("update available") until each tool next reports.

## Acceptance

- [ ] After a **successful** `laika update` (the checkout switched and passed
      its self-check), one client report is sent per installed tool credential
      (`~/.laika/agents/<harness>.json`) whose board origin is the board the
      update used, with that credential's own token.
- [ ] Version, commit and protocol come from the **new** checkout's
      `laika version --json` (the self-check's output), not from the running,
      older process.
- [ ] Nothing is sent when the board's manifest says `client_reports` is not
      `true`; no line is printed about it then.
- [ ] A failed report (refused, unreachable) is one line and never changes the
      exit code or rolls anything back. No token appears in any output.
- [ ] The `update.ts` header no longer says `~/.laika/agents/*` is never
      opened: it is opened read-only, for the report.
- [ ] Tests for each of the above; cli typecheck, eslint and prettier exit 0;
      PR into `master`, CI green.
