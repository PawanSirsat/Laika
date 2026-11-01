---
id: LAI-967
title: 'Organisation’s Developer insights note and two profile empty lines still describe a personal sharing switch D-102 (amended) removed'
area: web
assignee: shell
priority: p2
depends-on: [LAI-963, LAI-964]
discovered-from: LAI-964
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T14:28:14Z
finished: 2026-10-22T14:40:28Z
---

## Goal

LAI-964 replaced the personal *Share my local activity* switch on Developer
access and Connect with a notice (D-102 amended: collection follows the
organisation's switch alone). Three other `server/web/` places still describe
the old switch, and were outside LAI-964's criteria. Found with
`grep -rn "for themselves\|sharing\.enabled\|not_sharing" server/web/src`
(untruncated) on LAI-964's branch.

## Acceptance criteria

- [x] `routes/screens/organisation/OrganisationScreen.tsx`, the
      `#org-insights-note` (~line 419): it says *"each developer can choose —
      for themselves, on Connect — to share … Nothing is collected from anyone
      who has not turned it on"*. That is false since LAI-963. Say that when on,
      every connected machine's local activity is collected and the person is
      told so; keep *"never prompt text …"* and *"Off stops it for everyone at
      once"*. `developer-insights.test.ts` asserts
      `/each developer can choose — for themselves/` today and changes with it.
- [x] `routes/screens/profile/UsageCard.tsx` `emptyLine` (~204) and
      `routes/screens/profile/ActivityCard.tsx` (~135, `not_sharing`): the
      `!sharing.enabled` branch tells a person to *"Turn on Share local activity
      on Connect"* or says *"<name> has not turned on sharing"*. The server now
      sends `enabled` equal to `org_enabled`, so the branch is unreachable from
      a current server. Remove it or reword it; neither may send anyone to a
      switch that no longer exists.
- [x] Light/dark, 1440/390 where wording changes. Gate exit 0.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #61.
